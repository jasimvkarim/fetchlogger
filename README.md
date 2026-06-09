# @jasimvk/fetchlogger

[![npm version](https://img.shields.io/npm/v/@jasimvk/fetchlogger?color=cb3837&logo=npm)](https://www.npmjs.com/package/@jasimvk/fetchlogger)
[![npm downloads](https://img.shields.io/npm/dm/@jasimvk/fetchlogger?color=blue)](https://www.npmjs.com/package/@jasimvk/fetchlogger)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@jasimvk/fetchlogger?color=success)](https://bundlephobia.com/package/@jasimvk/fetchlogger)
[![license](https://img.shields.io/npm/l/@jasimvk/fetchlogger?color=lightgrey)](./LICENSE)
[![types](https://img.shields.io/npm/types/@jasimvk/fetchlogger)](https://www.npmjs.com/package/@jasimvk/fetchlogger)

A live, in-page **fetch logger panel** for debugging API calls — see every request/response without opening DevTools. Framework-agnostic core with an optional React wrapper.

- 🛰 Floating panel, collapsible, draggable position
- 🔎 Filter by URL or API code
- ↑↓ Click a request to inspect request + response bodies
- ⚡ Zero dependencies in the core (React is an optional peer)
- 🧩 Works in React, Vue, Svelte, or plain JS

## Install

```bash
npm i -D @jasimvk/fetchlogger
```

## React

```tsx
import FetchLogger from "@jasimvk/fetchlogger/react";

export default function App() {
  return (
    <>
      {/* render once near the root */}
      {process.env.NODE_ENV !== "production" && <FetchLogger />}
      {/* ...your app... */}
    </>
  );
}
```

> Tip: gate it however you like — `NODE_ENV`, an env flag, or a branch. The
> package itself never gates; you decide where it shows.

## Any framework / plain JS

```ts
import { mountFetchLoggerPanel } from "@jasimvk/fetchlogger";

const unmount = mountFetchLoggerPanel({ position: "bottom-center" });
// later: unmount();
```

## Just the data (no UI)

```ts
import { installFetchLogger, subscribe } from "@jasimvk/fetchlogger";

installFetchLogger({ getLabel: (body) => (body as any)?.API_Code });
const off = subscribe((log) => console.log(log.method, log.url, log.status));
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `maxLogs` | `100` | Max logs kept in memory (FIFO). |
| `getLabel` | — | Derive a short label from the parsed JSON body (e.g. an API code). |
| `captureResponseBody` | `true` | Clone + read response bodies. |
| `autoRedact` | `true` | Auto-mask values whose key looks like a secret (`token`, `password`, `authorization`, `apiKey`, `secret`, `cookie`…). |
| `redact` | — | `(log) => log` hook to strip/mask sensitive data before it is stored or shown. Runs after `autoRedact`. |
| `maxBodyChars` | `20000` | Truncate captured request/response bodies longer than this. |
| `silenceProductionWarning` | `false` | Suppress the console warning shown when installed in a production build. |
| `defaultOpen` | `false` | Start expanded (panel only). |
| `position` | `"bottom-center"` | `bottom-center` \| `bottom-right` \| `bottom-left` (panel only). |
| `container` | `document.body` | Where to mount the panel. |
| `autoInstall` | `true` | Patch fetch on mount (panel only). |

## API

- `mountFetchLoggerPanel(options?) => () => void` — mount the floating panel, returns unmount.
- `installFetchLogger(options?) => () => void` — patch `fetch`, returns uninstall.
- `uninstallFetchLogger()` — restore original `fetch`.
- `subscribe(fn) => () => void` — listen to log events.
- `getLogs()` / `clearLogs()` / `isInstalled()`
- Types: `FetchLog`, `InstallOptions`, `MountOptions`.

## How it works

Patches `window.fetch`, recording method, URL, parsed JSON request/response
bodies, status, and timing into an in-memory store. The panel subscribes to the
store and renders live. It only touches the browser (`typeof window` guarded),
so it's safe to import in SSR — it no-ops on the server.

## Security

This tool **displays request and response bodies**, which can contain tokens,
passwords, or personal data. A few things to know:

- **Don't ship it to production.** Gate it to development (`NODE_ENV`, an env
  flag, or a branch). If it loads in a production build it logs a one-time
  `console.warn` (silence with `silenceProductionWarning: true`).
- **Secrets are auto-masked.** Values under keys that look sensitive
  (`token`, `password`, `authorization`, `apiKey`, `secret`, `cookie`, …) are
  replaced with `«redacted»` before being stored or shown. Disable with
  `autoRedact: false`, or add your own rules via the `redact(log)` hook.
- **No data leaves the browser.** Logs are kept in memory only — never sent
  anywhere, never written to `localStorage`/cookies, and cleared on reload.
- **Request headers are not captured** (only `content-type` is read to decide
  JSON vs text). Note that full URLs *are* shown, so avoid putting secrets in
  query strings.

```ts
installFetchLogger({
  // mask anything else you don't want on screen
  redact: (log) => ({ ...log, url: log.url.replace(/token=[^&]+/g, "token=•••") }),
});
```

## License

MIT
