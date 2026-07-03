// Framework-agnostic core: patches window.fetch and keeps an in-memory log store
// with a simple pub/sub. No DOM, no React — usable anywhere.

export interface FetchLog {
  id: number;
  method: string;
  url: string;
  apiCode?: string;
  status?: number;
  elapsed?: number;
  reqBody?: unknown;
  resBody?: unknown;
  error?: string;
  /** True when this entry was served/altered by an override rule. */
  overridden?: boolean;
  pending: boolean;
  ts: number;
}

export interface InstallOptions {
  /** Max logs kept in memory (FIFO). Default 100. */
  maxLogs?: number;
  /** Pull a short label out of the parsed JSON request body (e.g. an API code). */
  getLabel?: (reqBody: unknown, url: string, method: string) => string | undefined;
  /** Capture response bodies (clones the response). Default true. */
  captureResponseBody?: boolean;
  /**
   * Redact sensitive data before it is stored/displayed. Runs on every completed
   * log. Mutate or return a new log. Use this to strip tokens, passwords, PII.
   * On top of this hook, common secret-looking keys are masked automatically
   * unless `autoRedact` is set to false.
   */
  redact?: (log: FetchLog) => FetchLog;
  /** Auto-mask obvious secret keys (token, password, authorization, secret, apiKey…). Default true. */
  autoRedact?: boolean;
  /** Truncate captured request/response bodies longer than this many chars. Default 20000. */
  maxBodyChars?: number;
  /**
   * Suppress the console warning shown when the logger is installed in a
   * production build (process.env.NODE_ENV === "production"). Default false.
   */
  silenceProductionWarning?: boolean;
  /**
   * Allow capturing request/response bodies in a production build. Default false:
   * in production the logger still records method/URL/status/timing but does NOT
   * capture bodies, so tokens and user data can't leak. Set true to opt back in.
   */
  allowInProduction?: boolean;
}

type Listener = (log: FetchLog) => void;

let _counter = 0;
let _originalFetch: typeof fetch | null = null;
let _maxLogs = 100;
let _opts: InstallOptions = {};
const _logs: FetchLog[] = [];
const _listeners = new Set<Listener>();

const SECRET_KEY_RE = /(pass(word)?|token|secret|authorization|auth|api[-_]?key|client[-_]?secret|cookie|session|credential|private[-_]?key|access[-_]?token|refresh[-_]?token|bearer)/i;
const REDACTED = "«redacted»";

/**
 * Mask secret-looking tokens embedded in a free-text string (bodies that aren't
 * JSON objects, e.g. a raw JWT, a `Bearer …` header echo, or a urlencoded form).
 * Conservative on purpose — only patterns that are unambiguously secrets.
 */
// JWT: three base64url segments separated by dots.
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// `Bearer <token>` — keep the scheme word, mask the token.
const BEARER_RE = /\b(Bearer)\s+[A-Za-z0-9._~+/-]+=*/gi;
// urlencoded / form secret pairs: token=…, access_token=…, api_key=…, password=…, secret=…
const SECRET_PAIR_RE =
  /\b(access[-_]?token|refresh[-_]?token|api[-_]?key|client[-_]?secret|password|token|secret|authorization|auth|sig|signature)=([^&\s"']+)/gi;
const scrubString = (s: string): string =>
  s
    .replace(JWT_RE, REDACTED)
    .replace(BEARER_RE, `$1 ${REDACTED}`)
    .replace(SECRET_PAIR_RE, `$1=${REDACTED}`);

/** Recursively mask values whose key looks like a secret. Returns a safe copy. */
const autoMask = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (depth > 6 || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => autoMask(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) ? REDACTED : autoMask(v, depth + 1);
  }
  return out;
};

/**
 * Mask secret-looking query params and userinfo in a URL, leaving the rest
 * intact and readable. Returns the original string unchanged if it can't be
 * parsed, so a malformed URL never breaks logging.
 */
// URL-safe redaction marker — plain ASCII so URLSearchParams doesn't percent-
// encode it into unreadable noise in the panel.
const URL_REDACTED = "REDACTED";
// Params that are secrets by exact name but too short/generic to substring-match
// safely (e.g. bare `sig` would also hit "de-sig-n"). Presigned-URL signatures.
const SECRET_PARAM_RE = /^(sig|signature|x-amz-signature|x-goog-signature)$/i;
const redactUrl = (url: string): string => {
  try {
    const base =
      typeof location !== "undefined" && location.origin ? location.origin : "http://x";
    const u = new URL(url, base);
    let touched = false;
    u.searchParams.forEach((val, key) => {
      if ((SECRET_KEY_RE.test(key) || SECRET_PARAM_RE.test(key)) && val) {
        u.searchParams.set(key, URL_REDACTED);
        touched = true;
      }
    });
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      touched = true;
    }
    if (!touched) return url; // avoid re-encoding/normalising untouched URLs
    // Preserve relative form for relative inputs (we joined against `base`).
    const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(url);
    return isAbsolute ? u.href : `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url;
  }
};

const truncate = (value: unknown, max: number): unknown => {
  if (typeof value === "string" && value.length > max) {
    return `${value.slice(0, max)}… «truncated ${value.length - max} chars»`;
  }
  return value;
};

/** Apply auto-masking, the user redact hook, and body-size limits to a completed log. */
const sanitize = (log: FetchLog): FetchLog => {
  let next = log;
  const maxBody = _opts.maxBodyChars ?? 20000;

  if (_opts.autoRedact !== false) {
    next = {
      ...next,
      url: redactUrl(next.url),
      reqBody: autoMask(next.reqBody),
      resBody: autoMask(next.resBody),
    };
  }
  next = {
    ...next,
    reqBody: truncate(next.reqBody, maxBody),
    resBody: truncate(next.resBody, maxBody),
  };
  if (_opts.redact) {
    try { next = _opts.redact(next); } catch { /* ignore redact errors */ }
  }
  return next;
};

const emit = (rawLog: FetchLog) => {
  const log = sanitize(rawLog);
  const idx = _logs.findIndex((l) => l.id === log.id);
  if (idx >= 0) _logs[idx] = log;
  else {
    _logs.push(log);
    if (_logs.length > _maxLogs) _logs.shift();
  }
  _listeners.forEach((fn) => fn(log));
};

/** Subscribe to log events. Returns an unsubscribe function. */
export const subscribe = (fn: Listener): (() => void) => {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
};

/** Current snapshot of logs. */
export const getLogs = (): FetchLog[] => _logs.slice();

/** Clear the in-memory log list. */
export const clearLogs = (): void => {
  _logs.length = 0;
};

/** True if fetch is currently patched. */
export const isInstalled = (): boolean => _originalFetch !== null;

/**
 * True when the logger must stay off: a production build
 * (`NODE_ENV === "production"`) without an explicit `allowInProduction: true`.
 * Callers (and the panel) use this to avoid shipping the tool to end users.
 */
export const isProductionBlocked = (
  options: { allowInProduction?: boolean } = {},
): boolean => {
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  return nodeEnv === "production" && !options.allowInProduction;
};

// ── Throttle ────────────────────────────────────────────────────────────────
// Artificial latency applied to every patched fetch before it resolves. Handy
// for reproducing slow-network behaviour, spinners and timeouts.
let _throttleMs = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Set the global fetch delay in milliseconds (0 disables it). */
export const setThrottle = (ms: number): void => {
  _throttleMs = Math.max(0, Math.round(ms) || 0);
};
/** Current global throttle delay in milliseconds. */
export const getThrottle = (): number => _throttleMs;

// ── Overrides (mock a response, or rewrite a request before it is sent) ───────
export interface OverrideRule {
  id: number;
  enabled: boolean;
  /** Substring matched against the URL, or an exact match against the label/apiCode. */
  match: string;
  /**
   * "response" returns a mock without hitting the network.
   * "request" rewrites the outgoing body, then sends it and shows the real response.
   */
  mode: "response" | "request";
  /** Response status for mode "response". Default 200. */
  status: number;
  /** Response body (mode "response") or replacement request body (mode "request"). Raw text; treated as JSON when parseable. */
  body: string;
  /** Optional per-rule delay (ms); falls back to the global throttle. */
  delayMs?: number;
}

let _ovCounter = 0;
const _overrides: OverrideRule[] = [];
const _ovListeners = new Set<() => void>();
const emitOverrides = () => _ovListeners.forEach((fn) => fn());

/** Subscribe to override-list changes. Returns an unsubscribe function. */
export const subscribeOverrides = (fn: () => void): (() => void) => {
  _ovListeners.add(fn);
  return () => _ovListeners.delete(fn);
};
/** Snapshot of the current override rules. */
export const getOverrides = (): OverrideRule[] => _overrides.map((o) => ({ ...o }));
/** Add an override rule (sensible defaults applied). Returns the created rule. */
export const addOverride = (rule: Partial<OverrideRule> = {}): OverrideRule => {
  const created: OverrideRule = {
    id: ++_ovCounter,
    enabled: rule.enabled ?? true,
    match: rule.match ?? "",
    mode: rule.mode ?? "response",
    status: rule.status ?? 200,
    body: rule.body ?? "",
    delayMs: rule.delayMs,
  };
  _overrides.push(created);
  emitOverrides();
  return created;
};
/** Patch fields on an existing rule by id. */
export const updateOverride = (id: number, patch: Partial<OverrideRule>): void => {
  const r = _overrides.find((o) => o.id === id);
  if (!r) return;
  Object.assign(r, patch);
  emitOverrides();
};
/** Remove a rule by id. */
export const removeOverride = (id: number): void => {
  const i = _overrides.findIndex((o) => o.id === id);
  if (i >= 0) {
    _overrides.splice(i, 1);
    emitOverrides();
  }
};
/** Remove every override rule. */
export const clearOverrides = (): void => {
  _overrides.length = 0;
  emitOverrides();
};

const matchOverride = (url: string, apiCode?: string): OverrideRule | undefined =>
  _overrides.find(
    (o) =>
      o.enabled &&
      o.match &&
      (url.includes(o.match) || (!!apiCode && apiCode === o.match)),
  );

// ── Clear browser caches/storage ──────────────────────────────────────────────
/**
 * Best-effort clear of localStorage, sessionStorage, the Cache Storage API and
 * service-worker registrations. Useful for resetting a stuck session/app state.
 */
export const clearBrowserCache = async (): Promise<void> => {
  if (typeof window === "undefined") return;
  try { window.localStorage?.clear(); } catch { /* ignore */ }
  try { window.sessionStorage?.clear(); } catch { /* ignore */ }
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* ignore */ }
  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch { /* ignore */ }
};

/**
 * Patch window.fetch to record every request/response into the store.
 * Idempotent. Returns an uninstall function that restores the original fetch.
 */
export const installFetchLogger = (options: InstallOptions = {}): (() => void) => {
  if (typeof window === "undefined" || !window.fetch) return () => {};
  if (_originalFetch) return uninstallFetchLogger;

  _opts = options;
  _maxLogs = options.maxLogs ?? 100;

  // Safety: this is a debugging tool that captures request/response bodies. Never
  // ship it in production — so in a production build it disables itself entirely
  // (no fetch patch, nothing captured) unless the caller explicitly opts in with
  // { allowInProduction: true }.
  if (isProductionBlocked(options)) {
    if (!options.silenceProductionWarning && typeof console !== "undefined") {
      console.warn(
        "[fetchlogger] disabled in this production build — it won't patch fetch or " +
          "capture anything. Gate it to development, pass { allowInProduction: true } to " +
          "force it on, or { silenceProductionWarning: true } to hide this note.",
      );
    }
    return () => {};
  }

  _originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input
      : input instanceof URL ? input.href
      : (input as Request).url;
    const method = (
      init?.method || (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    let reqBody: unknown;
    if (init?.body) {
      try { reqBody = JSON.parse(init.body as string); }
      catch { reqBody = String(init.body); }
    }
    const apiCode = _opts.getLabel ? _opts.getLabel(reqBody, url, method) : undefined;

    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const ov = matchOverride(url, apiCode);

    // Request override: replace the outgoing body before the request is sent.
    let reqInput: RequestInfo | URL = input;
    let reqInit = init;
    if (ov && ov.mode === "request") {
      const headers = new Headers(
        (init?.headers as HeadersInit | undefined) ??
          (input instanceof Request ? input.headers : undefined),
      );
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      reqInit = { ...(init ?? {}), body: ov.body, headers };
      // If input was a Request, swap to its URL so our new init.body is used.
      if (input instanceof Request) reqInput = input.url;
      try { reqBody = JSON.parse(ov.body); } catch { reqBody = ov.body; }
    }

    const id = ++_counter;
    const t0 = now();
    const base: FetchLog = { id, method, url, apiCode, reqBody, pending: true, ts: Date.now() };
    emit({ ...base });

    // Throttle: artificial latency (a per-rule delay wins over the global one).
    const delay = ov?.delayMs ?? _throttleMs;
    if (delay > 0) await sleep(delay);

    // Response override: short-circuit the network and return a mock response.
    if (ov && ov.mode === "response") {
      const elapsed = Math.round(now() - t0);
      const status = ov.status || 200;
      let parsed: unknown = ov.body;
      let isJson = false;
      try { parsed = JSON.parse(ov.body); isJson = true; } catch { /* plain text */ }
      emit({ ...base, status, elapsed, resBody: isJson ? parsed : ov.body, pending: false, overridden: true });
      return new Response(ov.body, {
        status,
        headers: { "content-type": isJson ? "application/json" : "text/plain" },
      });
    }

    try {
      const response = await _originalFetch!(reqInput as any, reqInit);
      const elapsed = Math.round(now() - t0);

      let resBody: unknown;
      if (_opts.captureResponseBody !== false) {
        try {
          const clone = response.clone();
          const ct = response.headers.get("content-type") || "";
          resBody = ct.includes("application/json") ? await clone.json() : await clone.text();
        } catch { /* ignore */ }
      }
      emit({ ...base, status: response.status, elapsed, resBody, pending: false, overridden: ov ? true : undefined });
      return response;
    } catch (err: any) {
      const elapsed = Math.round(now() - t0);
      emit({ ...base, error: err?.message || "failed", elapsed, pending: false, overridden: ov ? true : undefined });
      throw err;
    }
  };

  return uninstallFetchLogger;
};

/** Restore the original window.fetch. */
export const uninstallFetchLogger = (): void => {
  if (typeof window === "undefined" || !_originalFetch) return;
  window.fetch = _originalFetch;
  _originalFetch = null;
};
