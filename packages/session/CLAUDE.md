# @rudderjs/session

Cookie-based session driver — `Session` facade, `sessionMiddleware(cfg)`, pluggable stores (memory, file, Redis).

## Architecture Rules

- **Auto-installs on the `web` route group** via `appendToGroup('web', sessionMiddleware(cfg))` in `SessionProvider.boot()`. Apps do NOT need `m.use(sessionMiddleware(...))` in `bootstrap/app.ts` — that's the old (pre-groups) pattern.
- **API routes are stateless** by default. If an api route needs session, mount `SessionMiddleware()` per-route.
- **`Session.current()` throws** when no ALS context exists. Use `Session.maybeCurrent()` / `Session.active()` for a non-throwing check — consumers inside middleware that may run in stateless contexts (e.g. `SessionGuard`) should guard with try/catch.

## Pitfalls

- Don't call `m.use(sessionMiddleware(cfg))` globally — it doubles up with the auto-install and reads from two different `SessionInstance`s. Symptom: session data set in the handler doesn't persist across requests.
