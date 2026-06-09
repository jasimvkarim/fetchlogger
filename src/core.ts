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

/** Recursively mask values whose key looks like a secret. Returns a safe copy. */
const autoMask = (value: unknown, depth = 0): unknown => {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => autoMask(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) ? REDACTED : autoMask(v, depth + 1);
  }
  return out;
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
    next = { ...next, reqBody: autoMask(next.reqBody), resBody: autoMask(next.resBody) };
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
 * Patch window.fetch to record every request/response into the store.
 * Idempotent. Returns an uninstall function that restores the original fetch.
 */
export const installFetchLogger = (options: InstallOptions = {}): (() => void) => {
  if (typeof window === "undefined" || !window.fetch) return () => {};
  if (_originalFetch) return uninstallFetchLogger;

  _opts = options;
  _maxLogs = options.maxLogs ?? 100;

  // Safety nudge: this tool displays request/response bodies. Warn if it is
  // being installed in a production build, where that could expose user data.
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  if (
    !options.silenceProductionWarning &&
    nodeEnv === "production" &&
    typeof console !== "undefined"
  ) {
    console.warn(
      "[fetchlogger] installed in a production build — it captures and displays " +
        "request/response bodies, which may expose tokens or user data. Gate it to " +
        "development, or pass { silenceProductionWarning: true } to dismiss.",
    );
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

    const id = ++_counter;
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const base: FetchLog = { id, method, url, apiCode, reqBody, pending: true, ts: Date.now() };
    emit({ ...base });

    try {
      const response = await _originalFetch!(input as any, init);
      const elapsed = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);

      let resBody: unknown;
      if (_opts.captureResponseBody !== false) {
        try {
          const clone = response.clone();
          const ct = response.headers.get("content-type") || "";
          resBody = ct.includes("application/json") ? await clone.json() : await clone.text();
        } catch { /* ignore */ }
      }
      emit({ ...base, status: response.status, elapsed, resBody, pending: false });
      return response;
    } catch (err: any) {
      const elapsed = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
      emit({ ...base, error: err?.message || "failed", elapsed, pending: false });
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
