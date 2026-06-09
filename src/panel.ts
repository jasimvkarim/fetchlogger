// Framework-agnostic floating panel rendered with plain DOM. Subscribes to the
// core store and shows requests live. React/Vue/etc. wrappers just call mount().

import {
  installFetchLogger,
  subscribe,
  getLogs,
  clearLogs,
  type InstallOptions,
} from "./core";
import {
  installConsoleLogger,
  subscribeConsole,
  getConsoleLogs,
  clearConsoleLogs,
  type ConsoleLevel,
  type ConsoleOptions,
} from "./console";

export interface MountOptions extends InstallOptions, ConsoleOptions {
  /** Auto-install the fetch patch when mounting. Default true. */
  autoInstall?: boolean;
  /** Also capture console.log/info/warn/error/debug into a Console tab. Default true. */
  captureConsole?: boolean;
  /** Start expanded. Default false (collapsed). */
  defaultOpen?: boolean;
  /** Where the panel anchors. Default "bottom-center". */
  position?: "bottom-center" | "bottom-right" | "bottom-left";
  /** Element to append the panel to. Default document.body. */
  container?: HTMLElement;
}

const consoleLevelColor = (level: ConsoleLevel) => {
  if (level === "error") return "#fca5a5";
  if (level === "warn") return "#fcd34d";
  if (level === "info") return "#93c5fd";
  if (level === "debug") return "#c4b5fd";
  return "#e2e8f0";
};

const statusColor = (status?: number) => {
  if (!status) return "#9ca3af";
  if (status >= 500) return "#ef4444";
  if (status >= 400) return "#f97316";
  if (status >= 300) return "#3b82f6";
  return "#10b981";
};

const el = (tag: string, style: Partial<CSSStyleDeclaration> = {}, text?: string) => {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
};

const copyToClipboard = (text: string): Promise<void> => {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for non-secure contexts.
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch (e) {
    return Promise.reject(e);
  }
};

/** A small "copy" button that flips to "copied ✓" briefly. */
const copyButton = (getText: () => string, label = "copy") => {
  const btn = el("span", {
    cursor: "pointer", fontSize: "9px", fontWeight: "bold", padding: "1px 6px",
    borderRadius: "4px", border: "1px solid #475569", color: "#cbd5e1",
    flexShrink: "0", userSelect: "none",
  }, label);
  btn.onclick = (e) => {
    e.stopPropagation();
    copyToClipboard(getText()).then(
      () => {
        btn.textContent = "copied ✓";
        btn.style.color = "#86efac";
        btn.style.borderColor = "#16a34a";
        setTimeout(() => {
          btn.textContent = label;
          btn.style.color = "#cbd5e1";
          btn.style.borderColor = "#475569";
        }, 1200);
      },
      () => {
        btn.textContent = "failed";
        setTimeout(() => { btn.textContent = label; }, 1200);
      },
    );
  };
  return btn;
};

const toText = (content: unknown): string =>
  content === undefined ? "" : typeof content === "string" ? content : JSON.stringify(content, null, 2);

/**
 * Mount the floating fetch-logger panel. Returns an unmount function that
 * removes the panel and (if autoInstall) restores the original fetch.
 */
export function mountFetchLoggerPanel(options: MountOptions = {}): () => void {
  if (typeof document === "undefined") return () => {};

  const uninstall =
    options.autoInstall === false ? () => {} : installFetchLogger(options);
  const uninstallConsole =
    options.captureConsole === false ? () => {} : installConsoleLogger(options);

  const container = options.container || document.body;
  let open = options.defaultOpen ?? false;
  let hidden = false;
  let selected: number | null = null;
  let urlExpanded = false;
  let filter = "";
  let tab: "network" | "console" = "network";
  // Once the user drags the panel, we pin it to an absolute left/top.
  let dragPos: { left: number; top: number } | null = null;

  const root = el("div", {
    position: "fixed",
    bottom: "12px",
    zIndex: "2147483647",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "11px",
    borderRadius: "10px",
    overflow: "hidden",
    boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
    background: "rgba(15,23,42,0.92)",
    color: "#e2e8f0",
    display: "flex",
    flexDirection: "column",
  });

  const place = (w: number) => {
    if (dragPos) {
      root.style.left = `${dragPos.left}px`;
      root.style.top = `${dragPos.top}px`;
      root.style.right = "";
      root.style.bottom = "";
      root.style.transform = "";
      return;
    }
    root.style.top = "";
    root.style.bottom = "12px";
    const pos = options.position || "bottom-center";
    if (pos === "bottom-right") { root.style.right = "12px"; root.style.left = ""; root.style.transform = ""; }
    else if (pos === "bottom-left") { root.style.left = "12px"; root.style.right = ""; root.style.transform = ""; }
    else { root.style.left = "50%"; root.style.right = ""; root.style.transform = `translateX(-50%)`; void w; }
  };

  container.appendChild(root);

  // ── Dragging: the header acts as a drag handle ──
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let baseLeft = 0;
  let baseTop = 0;

  const onPointerMove = (e: MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return; // small threshold = click, not drag
    moved = true;
    const maxLeft = Math.max(0, window.innerWidth - root.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - root.offsetHeight);
    dragPos = {
      left: Math.min(Math.max(0, baseLeft + dx), maxLeft),
      top: Math.min(Math.max(0, baseTop + dy), maxTop),
    };
    root.style.left = `${dragPos.left}px`;
    root.style.top = `${dragPos.top}px`;
    root.style.right = "";
    root.style.bottom = "";
    root.style.transform = "";
    e.preventDefault();
  };

  const onPointerUp = () => { dragging = false; };

  const startDrag = (e: MouseEvent) => {
    const rect = root.getBoundingClientRect();
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    baseLeft = rect.left;
    baseTop = rect.top;
  };

  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);

  const render = () => {
    root.innerHTML = "";
    const logs = getLogs();
    const clogs = getConsoleLogs();

    if (hidden) {
      root.style.width = "auto";
      root.style.maxHeight = "auto";
      const pill = el("button", {
        all: "unset", cursor: "pointer", padding: "6px 12px",
        color: "#a5b4fc", fontWeight: "bold", display: "block",
      } as any, `🛰 ${logs.length + clogs.length}`);
      pill.title = "Open Fetch Logger";
      pill.onclick = () => { hidden = false; open = true; render(); };
      root.appendChild(pill);
      return;
    }

    const W = !open ? 160 : selected != null ? Math.min(700, window.innerWidth - 16) : Math.min(340, window.innerWidth - 16);
    root.style.width = `${W}px`;
    root.style.maxHeight = open ? "480px" : "auto";
    place(W);

    // ── header (drag handle) ──
    const header = el("div", {
      display: "flex", alignItems: "center", gap: "8px",
      padding: "6px 10px", background: "rgba(30,41,59,0.8)", flexShrink: "0",
      cursor: "move", userSelect: "none",
    });
    header.onmousedown = startDrag;
    header.appendChild(el("span", { color: "#a5b4fc", fontWeight: "bold", fontSize: "12px" }, "⠿"));

    // Tab switch
    const tabWrap = el("div", { display: "flex", gap: "2px", background: "rgba(15,23,42,0.6)", borderRadius: "6px", padding: "2px" });
    const mkTab = (id: "network" | "console", label: string, count: number) => {
      const active = tab === id;
      const btn = el("span", {
        cursor: "pointer", fontSize: "10px", fontWeight: "bold", padding: "2px 8px", borderRadius: "4px",
        color: active ? "#0f172a" : "#cbd5e1", background: active ? "#a5b4fc" : "transparent",
      }, `${label} ${count}`);
      btn.onclick = (e) => { e.stopPropagation(); tab = id; selected = null; render(); };
      return btn;
    };
    tabWrap.appendChild(mkTab("network", "Network", logs.length));
    tabWrap.appendChild(mkTab("console", "Console", clogs.length));
    header.appendChild(tabWrap);

    const ctrls = el("div", { marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" });
    if (open) {
      const clearBtn = el("span", { color: "#cbd5e1", cursor: "pointer" }, "✕ clear");
      clearBtn.onclick = (e) => {
        e.stopPropagation();
        if (tab === "console") clearConsoleLogs();
        else { clearLogs(); selected = null; }
        render();
      };
      ctrls.appendChild(clearBtn);
    }
    const toggle = el("span", { color: "#cbd5e1", cursor: "pointer", fontSize: "13px" }, open ? "▼" : "▲");
    toggle.onclick = () => { open = !open; render(); };
    ctrls.appendChild(toggle);
    const close = el("span", { color: "#f87171", cursor: "pointer", fontSize: "14px", fontWeight: "bold" }, "✕");
    close.title = "Close";
    close.onclick = () => { hidden = true; render(); };
    ctrls.appendChild(close);
    header.appendChild(ctrls);
    header.onclick = (e) => { if (!moved && e.target === header) { open = !open; render(); } };
    root.appendChild(header);

    if (!open) return;

    // ── Console tab ──
    if (tab === "console") {
      const consoleWrap = el("div", { display: "flex", flexDirection: "column", flex: "1", overflow: "hidden", minHeight: "0" });
      const cFilterWrap = el("div", { padding: "4px 6px", borderBottom: "1px solid #334155", flexShrink: "0" });
      const cInput = el("input", {
        width: "100%", background: "#1e293b", border: "1px solid #475569",
        borderRadius: "4px", color: "#f1f5f9", fontSize: "11px",
        padding: "3px 6px", outline: "none", boxSizing: "border-box",
      } as any) as HTMLInputElement;
      cInput.placeholder = "filter console…";
      cInput.value = filter;
      cInput.oninput = () => { filter = cInput.value; render(); cInput.focus(); };
      cFilterWrap.appendChild(cInput);
      consoleWrap.appendChild(cFilterWrap);

      const cRows = el("div", { overflowY: "auto", flex: "1" });
      const cFiltered = filter
        ? clogs.filter((l) => l.text.toLowerCase().includes(filter.toLowerCase()) || l.level.includes(filter.toLowerCase()))
        : clogs;
      if (cFiltered.length === 0) {
        cRows.appendChild(el("div", { padding: "12px", color: "#94a3b8", textAlign: "center" }, "no console output yet"));
      }
      cFiltered.forEach((log) => {
        const row = el("div", {
          display: "flex", alignItems: "flex-start", gap: "6px",
          padding: "4px 8px", borderBottom: "1px solid #1e293b",
          background: log.level === "error" ? "rgba(127,29,29,0.25)" : log.level === "warn" ? "rgba(120,53,15,0.2)" : "transparent",
        });
        row.appendChild(el("span", { color: consoleLevelColor(log.level), fontSize: "9px", fontWeight: "bold", minWidth: "34px", textTransform: "uppercase", flexShrink: "0" }, log.level));
        row.appendChild(el("span", { color: consoleLevelColor(log.level), fontSize: "10px", whiteSpace: "pre-wrap", wordBreak: "break-word", flex: "1" }, log.text));
        row.appendChild(copyButton(() => log.text));
        cRows.appendChild(row);
      });
      consoleWrap.appendChild(cRows);
      root.appendChild(consoleWrap);
      cRows.scrollTop = cRows.scrollHeight;
      return;
    }

    const body = el("div", { display: "flex", flex: "1", overflow: "hidden", minHeight: "0" });

    // ── list ──
    const detail = selected != null ? logs.find((l) => l.id === selected) : null;
    const list = el("div", {
      width: detail ? `${Math.min(240, Math.floor(W * 0.4))}px` : "100%",
      display: "flex", flexDirection: "column",
      borderRight: detail ? "1px solid #334155" : "none", flexShrink: "0",
    });

    const filterWrap = el("div", { padding: "4px 6px", borderBottom: "1px solid #334155" });
    const input = el("input", {
      width: "100%", background: "#1e293b", border: "1px solid #475569",
      borderRadius: "4px", color: "#f1f5f9", fontSize: "11px",
      padding: "3px 6px", outline: "none", boxSizing: "border-box",
    } as any) as HTMLInputElement;
    input.placeholder = "filter…";
    input.value = filter;
    input.oninput = () => { filter = input.value; render(); input.focus(); };
    filterWrap.appendChild(input);
    list.appendChild(filterWrap);

    const rows = el("div", { overflowY: "auto", flex: "1" });
    const filtered = filter
      ? logs.filter((l) => l.url.includes(filter) || (l.apiCode || "").toLowerCase().includes(filter.toLowerCase()))
      : logs;
    if (filtered.length === 0) {
      rows.appendChild(el("div", { padding: "12px", color: "#94a3b8", textAlign: "center" }, "no requests yet"));
    }
    filtered.forEach((log) => {
      const active = selected === log.id;
      const row = el("div", {
        display: "flex", alignItems: "center", gap: "5px",
        padding: "5px 8px", cursor: "pointer", borderBottom: "1px solid #334155",
        background: active ? "#334155" : "transparent",
        borderLeft: active ? "2px solid #a5b4fc" : "2px solid transparent",
      });
      const statusEl = log.pending
        ? el("span", { color: "#fbbf24", fontSize: "9px" }, "⏳")
        : el("span", { color: statusColor(log.status), minWidth: "24px", fontSize: "10px", fontWeight: "bold" }, log.error ? "ERR" : String(log.status));
      row.appendChild(statusEl);
      row.appendChild(el("span", { color: "#fbbf24", fontSize: "10px", minWidth: "28px", fontWeight: "bold" }, log.method));
      const label = log.apiCode || log.url.replace(/^https?:\/\/[^/]+/, "");
      row.appendChild(el("span", { color: "#e2e8f0", flex: "1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "10px" }, label));
      if (log.elapsed !== undefined) row.appendChild(el("span", { color: "#c4b5fd", fontSize: "9px", flexShrink: "0" }, `${log.elapsed}ms`));
      row.onclick = () => { selected = active ? null : log.id; urlExpanded = false; render(); };
      rows.appendChild(row);
    });
    list.appendChild(rows);
    body.appendChild(list);

    // ── detail ──
    if (detail) {
      const pane = el("div", { flex: "1", overflow: "hidden", display: "flex", flexDirection: "column" });
      const bar = el("div", { padding: "5px 10px", background: "#1e293b", borderBottom: "1px solid #475569", flexShrink: "0", display: "flex", alignItems: "flex-start", gap: "6px" });
      bar.appendChild(el("span", { color: "#fbbf24", fontWeight: "bold", flexShrink: "0" }, detail.method));
      bar.appendChild(el("span", { color: statusColor(detail.status), fontWeight: "bold", flexShrink: "0" }, String(detail.status ?? "")));

      // URL column: clamped to 2 lines with a "show more" toggle when long.
      const urlCol = el("div", { flex: "1", minWidth: "0", display: "flex", flexDirection: "column", gap: "2px" });
      const urlSpan = el("span", { color: "#cbd5e1", wordBreak: "break-all", fontSize: "10px" }, detail.url);
      if (!urlExpanded) {
        Object.assign(urlSpan.style, {
          display: "-webkit-box", webkitLineClamp: "2", webkitBoxOrient: "vertical", overflow: "hidden",
        } as Partial<CSSStyleDeclaration>);
      }
      urlCol.appendChild(urlSpan);
      if (detail.url.length > 90) {
        const more = el("span", { color: "#93c5fd", cursor: "pointer", fontSize: "9px", fontWeight: "bold", userSelect: "none" }, urlExpanded ? "show less" : "show more");
        more.onclick = (e) => { e.stopPropagation(); urlExpanded = !urlExpanded; render(); };
        urlCol.appendChild(more);
      }
      bar.appendChild(urlCol);

      if (detail.elapsed !== undefined) bar.appendChild(el("span", { color: "#c4b5fd", flexShrink: "0" }, `${detail.elapsed}ms`));
      bar.appendChild(copyButton(() => detail.url, "copy url"));
      const x = el("span", { color: "#94a3b8", cursor: "pointer", flexShrink: "0", paddingLeft: "4px" }, "✕");
      x.onclick = () => { selected = null; render(); };
      bar.appendChild(x);
      pane.appendChild(bar);

      const bodies = el("div", { display: "flex", flex: "1", overflow: "hidden", minHeight: "0" });
      const mkSide = (title: string, titleColor: string, content: unknown, color: string, border: boolean) => {
        const side = el("div", { flex: "1", display: "flex", flexDirection: "column", overflow: "hidden", borderRight: border ? "1px solid #334155" : "none" });
        const head = el("div", { display: "flex", alignItems: "center", gap: "6px", padding: "3px 8px", background: "rgba(22,32,50,0.7)", flexShrink: "0" });
        head.appendChild(el("span", { color: titleColor, fontSize: "10px", fontWeight: "bold", flex: "1" }, title));
        const text = toText(content);
        if (text) head.appendChild(copyButton(() => text));
        side.appendChild(head);
        const scroll = el("div", { flex: "1", overflowY: "auto", padding: "6px 8px" });
        const pre = el("pre", { margin: "0", color, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "10px" },
          content === undefined ? "— no body —" : typeof content === "string" ? content : JSON.stringify(content, null, 2));
        scroll.appendChild(pre);
        side.appendChild(scroll);
        return side;
      };
      bodies.appendChild(mkSide("↑ REQUEST", "#bfdbfe", detail.reqBody, "#bfdbfe", true));
      bodies.appendChild(mkSide("↓ RESPONSE", "#a7f3d0", detail.error ? `ERROR: ${detail.error}` : detail.resBody, detail.error ? "#fca5a5" : "#a7f3d0", false));
      pane.appendChild(bodies);
      body.appendChild(pane);
    }

    root.appendChild(body);
    rows.scrollTop = rows.scrollHeight;
  };

  const unsub = subscribe(() => render());
  const unsubConsole = subscribeConsole(() => render());
  render();

  return () => {
    unsub();
    unsubConsole();
    uninstall();
    uninstallConsole();
    window.removeEventListener("mousemove", onPointerMove);
    window.removeEventListener("mouseup", onPointerUp);
    if (root.parentNode) root.parentNode.removeChild(root);
  };
}
