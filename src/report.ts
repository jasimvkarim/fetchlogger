// Build a shareable, paste-ready debug report from a captured request — the
// kind of thing a tester drops into a bug ticket for a developer.

import type { FetchLog } from "./core";
import { getConsoleLogs } from "./console";

const formatBody = (body: unknown): string => {
  if (body === undefined || body === null) return "(none)";
  if (typeof body === "string") return body || "(empty)";
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
};

export interface DebugReportOptions {
  /** Include captured console errors. Default true. */
  includeConsoleErrors?: boolean;
}

/**
 * Produce a plain-text debug report for a single request:
 *
 *   FetchLogger Debug Report
 *
 *   Method: POST
 *   URL: /api/login
 *   Status: 401
 *   Duration: 342ms
 *
 *   Request Body:
 *   ...
 *
 *   Response Body:
 *   ...
 *
 *   Console Errors:
 *   ...
 */
export function buildDebugReport(log: FetchLog, options: DebugReportOptions = {}): string {
  const status = log.error ? `ERROR (${log.error})` : log.status ?? "—";
  const duration = log.elapsed != null ? `${log.elapsed}ms` : "—";

  const lines: string[] = [
    "FetchLogger Debug Report",
    "",
    `Method: ${log.method}`,
    `URL: ${log.url}`,
    `Status: ${status}`,
    `Duration: ${duration}`,
    "",
    "Request Body:",
    formatBody(log.reqBody),
    "",
    "Response Body:",
    formatBody(log.resBody),
  ];

  if (options.includeConsoleErrors !== false) {
    const errors = getConsoleLogs().filter((l) => l.level === "error");
    lines.push("", "Console Errors:", errors.length ? errors.map((e) => e.text).join("\n") : "(none)");
  }

  return lines.join("\n");
}
