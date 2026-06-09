# WS-upgrade auth context — run session/auth middleware around `onAuth`

**Status:** proposed (2026-06-09)
**Packages:** `@rudderjs/core` (runner), `@rudderjs/sync` (delegation), `@rudderjs/session` + `@rudderjs/auth` (markers). No `@rudderjs/server-hono` change (O1 resolved — runner lives in core, covers dev + prod).
**Driver:** pilotiq-pro collab IDOR (audit 2026-06-09). The framework half — making `onAuth` enforceable — shipped in `@rudderjs/sync@1.5.1` (#1011). This is the follow-up that makes `onAuth` usable with the normal auth stack.

---

## Problem

`@rudderjs/sync`'s `onAuth(req, docName)` now runs on every WS upgrade (#1011), but it receives **only raw headers + url** — no `AsyncLocalStorage` context. So the idiomatic resolver `() => Auth.user()` returns `null` (the auth ALS `__rudderjs_auth_als__` was never populated — the HTTP auth middleware doesn't run on the upgrade path), and any app trying to authorize a collab room by user identity must hand-roll cookie→session→user parsing in app code.

We rejected pushing that parsing into the app (couples a published helper to `@rudderjs/session`/auth internals, version-fragile, duplicates middleware logic — see the pilotiq-pro audit memo). The right fix is in the framework: **establish the same request-scoped context an HTTP request gets, then run `onAuth` inside it**, so `Auth.user()` / `Session` "just work" and `collabAuthorize({ panel })` becomes trivial.

## Goal

Inside a sync `onAuth` callback, `Auth.user()` and `Session.*` resolve exactly as in an HTTP handler — with:
- **No app-side cookie/session parsing.**
- **No new `@rudderjs/sync` dependency on session/auth** (sync stays foundational; reaches the framework only via a `globalThis` seam, same pattern as the existing WS-upgrade chain).
- **Backward compatibility:** apps without the framework runner (standalone sync, no server adapter) keep today's behavior — `onAuth` runs raw.

## What exists today (verified in source)

| Concern | Location | Notes |
|---|---|---|
| Upgrade origin (prod) | `server-hono/src/index.ts:22` `srv.on('upgrade', (req,socket,head)=>…)` | `req` = Node `IncomingMessage` |
| Upgrade origin (dev) | `vite/src/index.ts:463` `httpServer.on('upgrade', …)` | same Node `(req,socket,head)` shape |
| Upgrade dispatch | both call `globalThis['__rudderjs_ws_upgrade__'](req,socket,head)` | handler registered by `sync` `boot()` (`sync/src/index.ts:1151`) |
| Sync flow | `__rudderjs_ws_upgrade__` → `wss.handleUpgrade` → `emit('connection')` → `handleConnection` → `onAuth` | onAuth gate added in #1011 (`sync/src/index.ts` `handleConnection`) |
| Web group stack | `server-hono` `_groupMiddleware.web` (`index.ts:614`), filled from core `getGroupHandlers('web')` (`core/src/app-builder.ts:124`, applied `:587`) | also exposed via `RudderJS.middlewareSnapshot()` (`app-builder.ts:610`) |
| Group registration | `appendToGroup('web', mw)` (core) → `globalThis` group store (`core/src/application.ts:373-388`) | how session/auth self-install |
| Middleware runner | `server-hono/src/index.ts:794` Express-style `(req,res,next)` onion | `await fn(req,res,next)` |
| Session middleware | `session/src/index.ts:482` `sessionMiddleware` | reads `req.headers['cookie']` → `driver.load()` → `await _als.run(session, next)` (`:504`) + `attachSession(req.raw)` (`:495`) + `session.save(res)` (`:510`) |
| Session ALS | `session/src/index.ts:205` module-level `_als`; `Session.maybeCurrent()`/`current()` read it; `_runWithSession` (`:278`) exported (test-only) | |
| Auth middleware | `auth/src/index.ts:89` `AuthMiddleware` | reads `req.raw['__rjs_session']` (`:95`), `await runWithAuth(manager, next)` (`:140`), syncs `req.user` from `session.get('auth_user_id')` |
| Auth ALS | `auth/src/auth-manager.ts:126` `__rudderjs_auth_als__` (globalThis-hoisted); `currentAuth()`/`auth()`/`Auth.user()` read it; `runWithAuth` (`:131`) | |
| User hydration | `SessionGuard.user()` → `session.get('auth_user_id')` → `provider.retrieveById(id)` | soft-fails to `null` with no ALS |

**Key consequence:** because each middleware wraps `next()` in its own ALS `.run(...)`, running the chain `[sessionMiddleware, AuthMiddleware]` with `onAuth` as the terminal `next` places `onAuth` inside both the session and auth ALS — **no middleware change required**.

## Design

### Central decision: run the context middleware, not the whole `web` group

The `web` group can contain CSRF, rate-limit, and arbitrary app middleware (`bootstrap/app.ts` `m.web(...)`). Running all of them on a WS upgrade is wrong — rate-limit would consume a token per upgrade; CSRF / app middleware assume a full HTTP req/res. So the runner executes **only the middleware that establish request-scoped context** (session + auth today).

Selection mechanism — **mark the context middleware** (recommended): `sessionMiddleware` and `AuthMiddleware` tag their returned function, e.g.

```ts
fn[REQUEST_CONTEXT] = true   // REQUEST_CONTEXT = Symbol.for('rudderjs.requestContext')
```

The runner filters the resolved `web` group to tagged handlers, preserving order. Apps that write their own ALS-establishing middleware can opt in by setting the same marker. (Alternative considered: a dedicated `appendToWsContext(mw)` registry parallel to `appendToGroup` — more explicit but more surface; the marker reuses existing group registration. Rejected: running the full group.)

### Components

1. **Context runner seam (`globalThis['__rudderjs_ws_context_runner__']`).** Registered in **`@rudderjs/core`** during `_createHandler()` (`app-builder.ts`), which runs at `.create()` in **both dev and prod** (it's where `getGroupHandlers('web')` is already read and applied — see O1, resolved). It closes over the marker-filtered web stack `mw.getGroupHandlers('web')`, so it needs no server-hono and no adapter. Shape:

   ```ts
   type WsContextRunner = <T>(rawReq: IncomingMessage, fn: () => T | Promise<T>) => Promise<T>
   ```

   It (a) synthesizes a minimal `AppRequest` from `rawReq`, (b) builds a throwaway `AppResponse`, (c) takes the tagged context middleware captured from the `web` group, (d) runs them onion-style with `fn` as the terminal, (e) returns `fn`'s result. Fail-closed is the caller's concern (sync), but the runner must propagate throws.

2. **Request synthesis.** From the Node `IncomingMessage`, build an `AppRequest` carrying what session+auth read: `headers` (incl. `cookie`), `url`, `method: 'GET'`, a mutable `raw: {}` (session writes `__rjs_session`, auth writes `__rjs_user`), and `ip`. Generic Node-`IncomingMessage`→`AppRequest` mapping — lives in core, no dependency on server-hono's `normalizeRequest` (which needs a Hono context we don't have). Far less than a routed request — no body, no params — because only session+auth run.

3. **Throwaway response.** Session middleware calls `session.save(res)` on the return path (appends `Set-Cookie`). For an upgrade there is no HTTP response; the runner passes a response whose `Set-Cookie` sink is discarded. See open question O2 (redis driver re-persist).

4. **Sync delegation (`handleConnection`).** Replace the direct `onAuth` call with:

   ```ts
   const runner = globalThis['__rudderjs_ws_context_runner__'] as WsContextRunner | undefined
   const decide = () => onAuth({ headers: rawReq.headers, url: rawReq.url ?? '/' }, docName)
   const allowed = runner
     ? await runner(rawReq, decide).catch(() => false)   // fail closed
     : await Promise.resolve().then(decide).catch(() => false)
   ```

   `handleConnection` already has the raw Node `req`. Sync gains nothing but a `globalThis` read — no new dependency.

5. **Markers.** One-line additions in `sessionMiddleware` and `AuthMiddleware` to tag their returned functions.

### Flow (after)

```
upgrade(req,socket,head)
  → __rudderjs_ws_upgrade__  (sync)
  → handleUpgrade → connection → handleConnection
      → runner(req, () => onAuth(...))            [server-hono]
          → synthesize AppRequest + throwaway res
          → [sessionMiddleware → AuthMiddleware → onAuth]   (onion; both ALS live)
          → onAuth: Auth.user() resolves → checkPolicy → boolean
      → allowed ? join room : close(4401)
```

`collabAuthorize({ panel })` then needs no resolver — it calls the app's normal `Auth.user()` inside `onAuth`.

## Edge cases & risks

- **Fail-closed everywhere.** Runner throw, middleware throw, or unresolved user → deny. The sync side wraps in `.catch(() => false)`.
- **Unauthenticated upgrade (no cookie).** `sessionMiddleware` marks a new session dirty and `save()` writes a `Set-Cookie` that is discarded; auth finds no `auth_user_id` → `Auth.user()` null → `onAuth` denies. Correct.
- **Redis session driver (O2).** `session.save()` → `driver.persist()` is a redis write (TTL refresh) per upgrade even on a read-only auth probe. Decide: accept the redundant write, or give the runner a read-only mode that skips `save()` (needs a small `sessionMiddleware` affordance, since `save` is internal to it).
- **Standalone sync / no server adapter.** No runner registered → `onAuth` runs raw (today's behavior). Apps then supply explicit resolution or no auth. Backward compatible.
- **Dev vs prod (O1 — RESOLVED).** Register from **core** (`_createHandler()`), not the adapter: `_createHandler()` runs at `.create()` in both dev and prod (it's where `getGroupHandlers('web')` is applied — proven by session/auth working in dev), and the web stack lives on `globalThis['__rudderjs_group_middleware__']`. No server-hono / vite-plugin involvement needed. Register the runner once at boot (guaranteed before any request/upgrade is authorized).
- **ALS bundle identity.** Session `_als` is module-level (not globalThis-hoisted like auth's). Safe here because the runner executes the *actual* `sessionMiddleware` function from the group, which closes over the same `_als` that `Session.current()` reads. Do not reimplement.

## Testing

- **server-hono unit:** runner given a cookie-bearing `IncomingMessage` resolves `Auth.user()` to the right user inside the callback; no/invalid cookie → `null`; a throwing middleware → runner rejects (caller denies).
- **sync unit:** `handleConnection` with a stub runner present → `onAuth` observes the resolved user; runner absent → raw behavior (existing tests stay green).
- **session/auth:** marker present on the returned middleware.
- **e2e (playground/pilotiq):** authed user with `view` on a record → room joins; unauthorized user → 4401. (Requires the playground `.user()` resolver to honor the session, not the hardcoded admin stub.)

## Sequencing

1. **PR A — framework runner + markers.** `core` registers `__rudderjs_ws_context_runner__` in `_createHandler()` (generic req synthesis + tagged-middleware onion, closing over `getGroupHandlers('web')`); `session` + `auth` add the `REQUEST_CONTEXT` marker on their middleware. Minor bumps (`core`, `session`, `auth`). No server-hono change.
2. **PR B — sync delegation.** `handleConnection` routes `onAuth` through the runner when present (fail-closed), else raw. `@rudderjs/sync` minor → release `1.6.0`.
3. **PR C — pilotiq-pro (downstream, the deferred Task B).** `collabAuthorize({ panel })` from `@pilotiq-pro/collab/server` (parse room → resource → record → `checkPolicy(R,'view', await Auth.user(), record)`, fail-closed); wire `onAuth: collabAuthorize({ panel: pilotiqAdmin })` in `playground/config/sync.ts`; bump sync to `1.6.0`.

PRs A+B can land together (same release). C waits on the release, as Task A/B handoff already notes.

## Open questions

- ~~**O1.** Where to register the runner so it covers dev + prod?~~ **RESOLVED:** core `_createHandler()` (runs at `.create()` in both; reads the globalThis web-group store). No adapter involvement.
- **O2.** Redis-driver re-persist on every upgrade: accept, or add a read-only runner mode that skips `session.save()`?
- **O3.** Should the runner expose itself more generally (e.g. for other out-of-band contexts — queue jobs that need a "request" user)? Out of scope here; note for reuse.
