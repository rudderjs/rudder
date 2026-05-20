# @rudderjs/server-hono

Hono.js server adapter — implements `ServerAdapter` from `@rudderjs/contracts`.

Normalizes Hono requests/responses, handles Vike SSR integration, WebSocket upgrade patching, and ViewResponse detection (duck-typed via `__rudder_view__`).

Peer of `@rudderjs/core` — never add core to `dependencies` (same cycle rule as router).

`req.ip` is set by `extractIp(c, trustProxy)` in `normalizeRequest()` — only reads `x-forwarded-for` / `x-real-ip` when `trustProxy: true`; returns `undefined` otherwise. Normalizes `::1` → `127.0.0.1`. In dev mode, the `rudderjs:ip` Vite plugin injects `x-real-ip` from the Node socket before universal-middleware converts to Web Request.

WebSocket upgrade must be patched at module load time, not lazily.

## Response header handling

`normalizeResponse` tracks Set-Cookie separately from other headers (as an array, not a record) so cooperative cookie-writing middleware — CsrfMiddleware + SessionMiddleware is the canonical pair — don't clobber each other. When the handler returns a `ViewResponse` or raw `Response`, `c.res` is set directly bypassing `res.json()/res.send()`; the route handler then calls a stashed `__rjs_merge_pending` function to append the wrapper's pending headers to `c.res.headers` in place. **Mutate, don't clone**: `new Response(body, { headers: someHeaders })` collapses multi-value Set-Cookie in Node's undici-backed fetch.

## Dev error page (`error-page.ts`)

Ignition-style HTML rendered for uncaught errors in `APP_ENV=local|dev`. Renders parsed stack frames, source-code context (with `resolveErrorLine` working around tsx / Vite-SSR's inaccurate line numbers), and a Copy-as-Markdown button.

**Editor-launch on stack frames** — frames are wrapped in `<a href="vscode://...">` anchors driven by the `APP_EDITOR` env var (default `vscode`; supports `cursor`, `webstorm`, `phpstorm`, `idea`, `sublime`, `atom`, `none`). Helper lives at `src/editor-launch.ts` — keep the per-editor URL templates there. Unknown values fall back to `vscode` with a single dev-time warning (`_warnedUnknown` is process-scoped). Windows paths are forward-slashed before being embedded in the URL — same portability fix as the dynamic-import pathToFileURL pattern.
