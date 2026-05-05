---
'@rudderjs/storage': patch
---

Two fixes on the temporary-URL + visibility surfaces from #216.

- **`serveTemporaryUrls({ routePath: '/foo/:path*' })` no longer throws on registration.** The previous prefix-derivation did `replace(/\*+$/, '').replace(/:?path\*$/, '')` — the first regex consumed the trailing `*`, so the second one could no longer match `:path*`, the prefix kept its `:path` segment, the `endsWith('/')` guard tripped, and the function threw the "must end in `/*` or `/:path*`" error it was supposed to be checking against. Both documented forms now resolve to the same `/foo/` prefix.

- **`LocalAdapter.move(from, to)` now moves the visibility sidecar alongside the file.** Visibility is stored in `<root>/.visibility/<path>` and `move()` only renamed the data file, so `getVisibility(to)` lost the source's visibility AND `put(from)` later inherited a stale value through the leaked sidecar. The sidecar now follows the file via the same `rename` → EXDEV-fallback `copyFile` + `unlink` ladder, with missing-sidecar (the common case — no prior `setVisibility`) silently no-oping.

Tests added: two for `serveTemporaryUrls` (both routePath shapes resolve to the same prefix; non-splat path still rejected) and two for `move()` sidecar handling (carries to destination, leaves no leftover at source; missing-sidecar move is a no-op).
