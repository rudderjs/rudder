# `@rudderjs/session` — duplicate `sessionMiddleware` installs are silent and clobber auth cookies

**Status:** proposed (2026-06-09)
**Packages:** `@rudderjs/session` (primary), `@rudderjs/core` (pipeline-assembly warning, optional)
**Driver:** pilotiq-pro collab IDOR investigation (pilotiq-pro PR #32). The playground ran `sessionMiddleware` twice — `SessionProvider.boot()` auto-installs it on the `web` group AND `bootstrap/app.ts` had a global `m.use(sessionMiddleware(cfg))`. The result silently broke login persistence and presented as a framework WS-auth bug; root-causing it cost a full debugging cycle. The framework was fine — but it let the misconfiguration through without a whisper.

---

## Problem

`SessionProvider.boot()` auto-installs the singleton middleware on the `web` route group:

```ts
// packages/session/src/index.ts:570-580
async boot(): Promise<void> {
  const cfg = config<SessionConfig>('session')
  ...
  const mw = sessionMiddleware(cfg)
  this.app.instance('session.middleware', mw)
  ...
  appendToGroup('web', mw)
```

An app that *also* registers session globally (`m.use(sessionMiddleware(cfg))` in `bootstrap/app.ts` — a natural thing to write coming from Express/Hono) gets **two independent `SessionInstance`s per request**:

- On a cookie-less request both instances are new + dirty, so **both append `Set-Cookie`**. The trailing one (the outer/anonymous instance, which never saw the inner instance's login write) **clobbers the authenticated cookie** in the browser.
- Concretely: `/dev-login` responded with two `Set-Cookie` headers; the browser kept the anonymous one; every subsequent request (including WS upgrades) carried an anonymous session, so `onAuth` correctly denied everyone. It looked exactly like a framework auth regression.

Nothing detects this today:

- `appendToGroup` is explicitly **not deduplicated** (`packages/core/src/application.ts:403-410`), by design.
- The global chain (`MiddlewareConfigurator.use()`, `packages/core/src/app-builder.ts:105`) and the group chain (`getGroupHandlers`, applied at `app-builder.ts:594-595`) are separate surfaces — same-fn-identity dedupe can't catch a *freshly constructed* second `sessionMiddleware(cfg)` anyway (different closure, different fn).

## Impact

- Silent until something depends on auth — sessions still "work" (flash, CSRF) because the inner instance wins within the request; only the *persisted cookie* is wrong, and only on cookie-less requests (first visit, fresh e2e context, curl). Worst-case presentation: intermittent login loss, deny-all WS auth, "storageState saved an anonymous session" in Playwright.
- The failure is two layers removed from the misconfiguration, and the misconfiguration is one redundant-looking line that reads as harmless.

## Fix options

1. **Marker symbol + runtime self-dedupe (recommended).** `sessionMiddleware()` already tags its return fn (`fn[REQUEST_CONTEXT] = true`, `packages/session/src/index.ts:525`); add a second marker, e.g. `fn[SESSION_MIDDLEWARE] = true`. At request time the middleware already runs the handler chain inside ALS (`_als.run(session, next)`, `index.ts:505`) — so an inner instance can detect an active outer session (`_als.getStore() !== undefined`) and **pass through** (reuse the outer session, skip its own save/Set-Cookie), emitting a warn-once in dev: *"sessionMiddleware is installed twice (SessionProvider auto-installs it on the `web` group — remove the global `m.use(sessionMiddleware(...))`)."* This neutralizes every topology (group + global, double-boot, per-route `SessionMiddleware()` on a web route) regardless of fn identity.

2. **Assembly-time warning (cheap, additive).** Where the effective chain is assembled (`getGroupHandlers` consumers, `packages/core/src/app-builder.ts:594-595` / `:626`), count handlers carrying the marker across global + group chains; if > 1, `console.warn` the same pointed message at boot. Catches the misconfiguration even before the first request, in the server log where people look.

Recommend **both**: (1) makes the duplicate harmless, (2) makes it visible. Either alone would have turned a day of WS-auth archaeology into a one-line log read.

## Verification

- Repro app with both registrations: cookie-less request to a login route → **one** `Set-Cookie` header; the authenticated cookie survives; dev warn emitted once.
- Single-registration apps: byte-identical behavior, no warn (existing session suite green, incl. the `REQUEST_CONTEXT` tagging test at `packages/session/src/index.test.ts:240`).
- Downstream re-check: pilotiq-pro playground with the bad `m.use` line temporarily restored → warning fires and login still persists.

## References

- `packages/session/src/index.ts:580` — `appendToGroup('web', mw)` auto-install; `:483` — `sessionMiddleware` factory; `:505` — ALS run; `:525` — existing `REQUEST_CONTEXT` marker precedent.
- `packages/core/src/application.ts:387-416` — group middleware store, explicitly non-deduplicating.
- `packages/core/src/app-builder.ts:105` (`MiddlewareConfigurator.use`), `:594-595`/`:626` (chain assembly sites).
- Field report: pilotiq-pro PR #32 (collab IDOR root cause + fix = deleting the app's global `m.use(sessionMiddleware(...))`).
