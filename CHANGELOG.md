# Changelog

All notable changes to `@jasimvk/fetchlogger` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-07-03

### Added
- **🎭 Mock tab / request overrides** — override any request, matched by URL substring
  or API label. Either return a **mock response** (status + body) with no backend, or
  **rewrite the outgoing request body** before it hits the server. Rules are toggleable;
  mocked rows get a `MOCK` badge.
- **🐢 Throttle slider** — add 0–5000 ms of artificial latency to every fetch to
  reproduce slow networks, spinners and timeouts.
- **🧹 Cache-clear button** — wipe `localStorage`, `sessionStorage`, Cache Storage and
  service workers in one click.
- New API: `addOverride`, `updateOverride`, `removeOverride`, `clearOverrides`,
  `getOverrides`, `subscribeOverrides`, `setThrottle`, `getThrottle`,
  `clearBrowserCache`; new `OverrideRule` type.

### Security
- **URL secrets are now redacted.** Secret-looking query params (`access_token`,
  `api_key`, `signature`, …) and `user:pass@` userinfo are stripped from the stored
  and displayed URL. Previously only JSON body keys were masked, so tokens in query
  strings leaked into the panel and the debug report.
- **Plain-text bodies are scrubbed.** JWTs, `Bearer …` tokens and urlencoded secret
  pairs inside non-JSON request/response bodies are masked, not just object keys.
- **Disabled in production.** In a production build (`NODE_ENV === "production"`)
  `installFetchLogger` and `mountFetchLoggerPanel` now no-op entirely — no fetch
  patch, no panel, nothing captured — so the debugger never ships to end users.
  New `allowInProduction: true` forces it on; new `isProductionBlocked(options)`
  exposes the check. **Behaviour change:** apps that ran the logger in production
  must set `allowInProduction: true`.
- Redaction affects only what is stored/displayed — the real network request is
  unchanged. All redaction respects `autoRedact: false`.
- **Build:** source maps are no longer published (smaller tarball, source not exposed).

## [0.2.0] - 2026-06-09

### Added
- **Copy Debug Report** — paste-ready bug report (method, URL, status, timing, request/
  response bodies, console errors) for bug tickets, via `buildDebugReport(log, options?)`.

## [0.1.9] - 2026-06-09

### Changed
- Panel now starts closed as a corner pill; `openOnActivity` auto-expands it, and the
  close button returns it to the pill.

## [0.1.8]

### Added
- `openOnActivity` — auto-expand the panel on the first request or console entry.

## [0.1.7]

### Changed
- Clicking a tab or its count now expands the panel.

## [0.1.6]

### Added
- Drag the panel by its header to reposition it.

## [0.1.5]

### Added
- Clamp long request URLs to 2 lines with a show more/less toggle.

## [0.1.4]

### Added
- Copy buttons for request/response bodies, URL, and console lines.

## [0.1.3]

### Added
- Capture console output with Network/Console tabs in the panel.

## [0.1.2]

### Security
- Auto-redact secrets, `redact()` hook, production warning, and request/response body
  size cap.

## [0.1.1]

### Added
- README badges and an `examples/` demo.

## [0.1.0]

### Added
- Initial release: live in-page `fetch`/XHR logger panel — framework-agnostic core with
  an optional React wrapper.

[0.3.0]: https://github.com/jasimvkarim/fetchlogger/releases/tag/v0.3.0
[0.2.0]: https://github.com/jasimvkarim/fetchlogger/releases/tag/v0.2.0
[0.1.9]: https://github.com/jasimvkarim/fetchlogger/releases/tag/v0.1.9
