---
"@rudderjs/vite": patch
---

Harden the build-time view scanner against codegen injection and a client-side header leak.

- **Filename / `export const route` values are validated before codegen.** The view id, import path, and route URL are interpolated verbatim into single-quoted string contexts inside the generated page modules (`+Page.tsx`, `+route.ts`, the typed registry). A view file with a crafted name (or route override) containing a quote, backtick, backslash, newline, or control char could break out of that string and corrupt — or inject code into — the generated source. Such views are now skipped with a warning instead of emitted; legitimate views (PascalCase names, slash-delimited routes) are unaffected.
- **Symlinked entries under `app/Views/` are ignored.** A symlinked file could point out of the app tree and be ingested as a view (generating a page that imports an arbitrary out-of-tree file). The scanner now skips symlinks during discovery.
- **`viewHeaders` is no longer serialized to the client.** The generated views-root config passed `['viewProps', 'viewHeaders']` to `passToClient`, shipping every controller response-header value — including per-request CSP nonces — into the client hydration payload for no consumer (`viewHeaders` is read only by the server-side `+headersResponse` hook). `passToClient` is now `['viewProps']` only.
