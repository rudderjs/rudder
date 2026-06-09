---
'@rudderjs/session': minor
'@rudderjs/contracts': minor
'@rudderjs/core': patch
---

feat(session): duplicate `sessionMiddleware` installs are now neutralized and warned about

`SessionProvider` auto-installs `sessionMiddleware` on the `web` group; an app that *also* registers it globally (`m.use(sessionMiddleware(cfg))` in bootstrap/app.ts) used to get two `SessionInstance`s per request — both appended `Set-Cookie`, and the trailing anonymous cookie clobbered the authenticated one on cookie-less requests (silent login loss, deny-all WS auth, two layers from the misconfigured line).

Now: the inner instance detects the outer session on the request bag, passes through (one session, one `Set-Cookie` — the authenticated cookie survives), and warns once with a pointed message. Detection is request-bag-based, so it also works when the two installs come from two module copies (workspace/linked dev). Additionally, `@rudderjs/core`'s pipeline assembly counts the new `SESSION_MIDDLEWARE` marker (exported from `@rudderjs/contracts`) across the global + web-group chains and warns at boot, before the first request. Single-install apps are byte-identical, no warnings.
