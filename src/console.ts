// Console capture: patches console.log/info/warn/error/debug and keeps an
// in-memory store with a simple pub/sub. Framework-agnostic, no DOM.

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";

export interface ConsoleLog {
  id: number;
  level: ConsoleLevel;
  /** One-line formatted preview of the arguments. */
  text: string;
  ts: number;
}

export interface ConsoleOptions {
  /** Max console entries kept in memory (FIFO). Default 200. */
  maxConsoleLogs?: number;
  /** Levels to capture. Default all five. */
  levels?: ConsoleLevel[];
}

type Listener = (log: ConsoleLog) => void;

const LEVELS: ConsoleLevel[] = ["log", "info", "warn", "error", "debug"];

let _counter = 0;
let _maxLogs = 200;
const _logs: ConsoleLog[] = [];
const _listeners = new Set<Listener>();
const _originals: Partial<Record<ConsoleLevel, (...args: unknown[]) => void>> = {};

const formatArg = (a: unknown): string => {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`;
  if (typeof a === "function") return `ƒ ${(a as { name?: string }).name || "anonymous"}`;
  if (a === undefined) return "undefined";
  if (a === null) return "null";
  if (typeof a === "object") {
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(a, (_k, v) => {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        return v;
      });
    } catch {
      return Object.prototype.toString.call(a);
    }
  }
  return String(a);
};

const emit = (level: ConsoleLevel, args: unknown[]) => {
  const log: ConsoleLog = {
    id: ++_counter,
    level,
    text: args.map(formatArg).join(" "),
    ts: Date.now(),
  };
  _logs.push(log);
  if (_logs.length > _maxLogs) _logs.shift();
  _listeners.forEach((fn) => fn(log));
};

/** Subscribe to console events. Returns an unsubscribe function. */
export const subscribeConsole = (fn: Listener): (() => void) => {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
};

/** Current snapshot of captured console logs. */
export const getConsoleLogs = (): ConsoleLog[] => _logs.slice();

/** Clear captured console logs. */
export const clearConsoleLogs = (): void => {
  _logs.length = 0;
};

/** True if console is currently patched. */
export const isConsoleInstalled = (): boolean => Object.keys(_originals).length > 0;

/**
 * Patch console methods to record their output. Idempotent. The original
 * console still works normally. Returns an uninstall function.
 */
export const installConsoleLogger = (options: ConsoleOptions = {}): (() => void) => {
  if (typeof console === "undefined") return () => {};
  if (isConsoleInstalled()) return uninstallConsoleLogger;

  _maxLogs = options.maxConsoleLogs ?? 200;
  const levels = options.levels ?? LEVELS;

  for (const level of levels) {
    const original = (console as unknown as Record<string, (...a: unknown[]) => void>)[level];
    if (typeof original !== "function") continue;
    _originals[level] = original.bind(console);
    (console as unknown as Record<string, (...a: unknown[]) => void>)[level] = (
      ...args: unknown[]
    ) => {
      try { emit(level, args); } catch { /* never break the app's logging */ }
      _originals[level]!(...args);
    };
  }

  return uninstallConsoleLogger;
};

/** Restore the original console methods. */
export const uninstallConsoleLogger = (): void => {
  for (const level of Object.keys(_originals) as ConsoleLevel[]) {
    (console as unknown as Record<string, (...a: unknown[]) => void>)[level] = _originals[level]!;
    delete _originals[level];
  }
};
