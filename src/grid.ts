// JSON grid view: renders a captured body as a drill-down table instead of a
// blob of pretty-printed text. No dependencies, no CSS file — inline styles in
// the same dark palette the panel uses everywhere else.
//
// Three shapes, because that is all JSON bodies ever are:
//   [{...}, {...}]  -> one column per key (union, first-seen order), one row per item
//   [1, 2, 3]       -> index + value
//   {...}           -> key + value
// Anything nested renders as a clickable chip that pushes onto the path, so a
// deep payload is walked rather than scrolled.

/** Where the viewer currently is inside the body, plus the active column sort. */
export interface GridState {
  /** Keys/indices from the root to the node on screen. Empty = root. */
  path: (string | number)[];
  /** Active sort for the current array-of-objects table. */
  sort: { key: string; dir: 1 | -1 } | null;
}

export const newGridState = (): GridState => ({ path: [], sort: null });

const KEY_COLOR = "#93c5fd";
const CHIP_COLOR = "#c084fc";
const BORDER = "1px solid #334155";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Bodies arrive either parsed (core stores JSON as objects) or as a raw string
 * when the response wasn't JSON — or was truncated by maxBodyChars. Try to
 * parse strings so a JSON string still grids; give up quietly if it doesn't.
 */
export const coerceJson = (content: unknown): unknown => {
  if (typeof content !== "string") return content;
  const trimmed = content.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return content;
  try {
    return JSON.parse(trimmed);
  } catch {
    return content;
  }
};

/** Only offer the grid toggle for things a table can actually improve. */
export const isGriddable = (content: unknown): boolean => {
  const v = coerceJson(content);
  return Array.isArray(v) ? v.length > 0 : isPlainObject(v) && Object.keys(v).length > 0;
};

const el = (tag: string, style: Partial<CSSStyleDeclaration> = {}, text?: string) => {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Colour a primitive by its type, the way a JSON viewer would. */
const primitiveCell = (v: unknown): HTMLElement => {
  if (v === null) return el("span", { color: "#64748b", fontStyle: "italic" }, "null");
  if (v === undefined) return el("span", { color: "#64748b", fontStyle: "italic" }, "undefined");
  if (typeof v === "number") return el("span", { color: "#fcd34d" }, String(v));
  if (typeof v === "boolean") return el("span", { color: "#c4b5fd" }, String(v));
  return el("span", { color: "#86efac", wordBreak: "break-word" }, String(v));
};

/** A nested object/array renders as a chip showing its size; clicking drills in. */
const chip = (v: unknown, onDrill: () => void): HTMLElement => {
  const count = Array.isArray(v) ? v.length : Object.keys(v as object).length;
  const label = Array.isArray(v) ? `[ ${count} ]` : `{ ${count} }`;
  const node = el("span", {
    color: CHIP_COLOR, cursor: "pointer", fontWeight: "bold", userSelect: "none",
    border: `1px solid ${CHIP_COLOR}`, borderRadius: "3px", padding: "0 4px", fontSize: "9px",
  }, label);
  node.onclick = (e) => { e.stopPropagation(); onDrill(); };
  return node;
};

const cell = (v: unknown, onDrill: () => void): HTMLElement =>
  isPlainObject(v) || Array.isArray(v) ? chip(v, onDrill) : primitiveCell(v);

const td = (child: HTMLElement): HTMLElement => {
  const node = el("td", { border: BORDER, padding: "2px 6px", verticalAlign: "top", maxWidth: "260px" });
  node.appendChild(child);
  return node;
};

const th = (label: string): HTMLElement =>
  el("th", {
    border: BORDER, padding: "2px 6px", textAlign: "left", color: KEY_COLOR,
    background: "rgba(30,41,59,0.95)", position: "sticky", top: "0", whiteSpace: "nowrap",
  }, label);

/** Sort primitives sensibly; anything non-primitive sorts by its JSON text. */
const compare = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 0 : a ? 1 : -1;
  const as = typeof a === "object" ? JSON.stringify(a) : String(a);
  const bs = typeof b === "object" ? JSON.stringify(b) : String(b);
  return as.localeCompare(bs);
};

/** Walk `path` from the root, returning the node and the path that resolved. */
const resolve = (root: unknown, path: (string | number)[]) => {
  let node: unknown = root;
  const walked: (string | number)[] = [];
  for (const seg of path) {
    if (!isPlainObject(node) && !Array.isArray(node)) break;
    const next = (node as Record<string | number, unknown>)[seg as never];
    if (next === undefined) break;
    node = next;
    walked.push(seg);
  }
  return { node, walked };
};

/**
 * Render `root` as a grid, positioned by `state`. Mutates `state` on navigation
 * and calls `onChange` so the host can re-render — the panel rebuilds its whole
 * tree on every render, so the state has to live outside this function.
 */
export function renderJsonGrid(
  root: unknown,
  state: GridState,
  onChange: () => void,
): HTMLElement {
  const value = coerceJson(root);
  // The body can change under us (a re-fetch, a different row). If the stored
  // path no longer resolves, fall back to as far as it does rather than erroring.
  const { node, walked } = resolve(value, state.path);
  if (walked.length !== state.path.length) state.path = walked;

  const wrap = el("div", { display: "flex", flexDirection: "column", height: "100%", minHeight: "0" });

  // ── breadcrumb ──
  const crumbs = el("div", {
    display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px",
    padding: "2px 6px", fontSize: "9px", flexShrink: "0", borderBottom: BORDER,
  });
  const crumb = (label: string, depth: number) => {
    const last = depth === state.path.length;
    const node = el("span", {
      color: last ? "#e2e8f0" : KEY_COLOR, cursor: last ? "default" : "pointer",
      fontWeight: last ? "bold" : "normal", userSelect: "none",
    }, label);
    if (!last) {
      node.onclick = (e) => {
        e.stopPropagation();
        state.path = state.path.slice(0, depth);
        state.sort = null;
        onChange();
      };
    }
    return node;
  };
  crumbs.appendChild(crumb("root", 0));
  state.path.forEach((seg, i) => {
    crumbs.appendChild(el("span", { color: "#475569" }, "›"));
    crumbs.appendChild(crumb(String(seg), i + 1));
  });
  wrap.appendChild(crumbs);

  const scroll = el("div", { flex: "1", overflow: "auto", minHeight: "0" });
  const table = el("table", {
    borderCollapse: "collapse", fontSize: "10px", width: "100%", color: "#e2e8f0",
  });
  const drill = (seg: string | number) => () => {
    state.path = [...state.path, seg];
    state.sort = null;
    onChange();
  };

  if (Array.isArray(node) && node.length > 0 && node.every(isPlainObject)) {
    // ── array of objects: one column per key ──
    const cols: string[] = [];
    for (const row of node) for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k);

    const headRow = el("tr");
    headRow.appendChild(th("#"));
    cols.forEach((key) => {
      const active = state.sort?.key === key;
      const cellEl = th(`${key}${active ? (state.sort!.dir === 1 ? " ▲" : " ▼") : ""}`);
      cellEl.style.cursor = "pointer";
      cellEl.style.userSelect = "none";
      if (active) cellEl.style.color = "#fbbf24";
      cellEl.onclick = (e) => {
        e.stopPropagation();
        // Click cycles asc -> desc -> unsorted, so the original order is reachable.
        if (!active) state.sort = { key, dir: 1 };
        else if (state.sort!.dir === 1) state.sort = { key, dir: -1 };
        else state.sort = null;
        onChange();
      };
      headRow.appendChild(cellEl);
    });
    table.appendChild(el("thead")).appendChild(headRow);

    // Keep the original index visible after a sort, so a sorted row still
    // drills into the right element.
    let indexed = node.map((row, i) => ({ row, i }));
    if (state.sort) {
      const { key, dir } = state.sort;
      indexed = [...indexed].sort((a, b) => dir * compare(a.row[key], b.row[key]));
    }

    const tbody = el("tbody");
    indexed.forEach(({ row, i }) => {
      const tr = el("tr");
      const idx = el("span", { color: "#64748b" }, String(i));
      const idxCell = td(idx);
      idxCell.style.cursor = "pointer";
      idxCell.onclick = drill(i);
      tr.appendChild(idxCell);
      cols.forEach((key) => tr.appendChild(td(cell(row[key], drill(i)))));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  } else if (Array.isArray(node)) {
    // ── array of primitives (or mixed) ──
    const headRow = el("tr");
    headRow.appendChild(th("#"));
    headRow.appendChild(th("value"));
    table.appendChild(el("thead")).appendChild(headRow);
    const tbody = el("tbody");
    node.forEach((v, i) => {
      const tr = el("tr");
      tr.appendChild(td(el("span", { color: "#64748b" }, String(i))));
      tr.appendChild(td(cell(v, drill(i))));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  } else if (isPlainObject(node)) {
    // ── object: key / value ──
    const headRow = el("tr");
    headRow.appendChild(th("key"));
    headRow.appendChild(th("value"));
    table.appendChild(el("thead")).appendChild(headRow);
    const tbody = el("tbody");
    Object.keys(node).forEach((key) => {
      const tr = el("tr");
      tr.appendChild(td(el("span", { color: KEY_COLOR, whiteSpace: "nowrap" }, key)));
      tr.appendChild(td(cell(node[key], drill(key))));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  } else {
    // ── leaf: drilled all the way down to a primitive ──
    const tbody = el("tbody");
    const tr = el("tr");
    tr.appendChild(td(primitiveCell(node)));
    tbody.appendChild(tr);
    table.appendChild(tbody);
  }

  scroll.appendChild(table);
  wrap.appendChild(scroll);
  return wrap;
}
