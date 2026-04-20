---
'@rudderjs/auth': minor
'create-rudder-app': patch
---

Add `BaseAuthController` + restructure scaffolded auth routes (Laravel Breeze-style).

**`@rudderjs/auth`** — new `BaseAuthController` abstract class. Ship the five standard auth POST handlers (`sign-in/email`, `sign-up/email`, `sign-out`, `request-password-reset`, `reset-password`) as decorated methods on a base class. Subclasses set `userModel`, `hash`, and `passwordBroker`; override any method to customize. Decorator metadata is inherited through the prototype chain — `Route.registerController(YourAuthController)` picks up all five routes without re-decorating.

New exports: `BaseAuthController`, `AuthUserModelLike`, `AuthHashLike`.

**`create-rudder-app`** — two fixes rolled together:

1. **Bug fix.** The session-mutating auth handlers were emitted into `routes/api.ts`, but `SessionMiddleware` is only auto-installed on the **web** group. `Auth.attempt/login/logout` calls `session.regenerate()`, which threw `No session in context` on sign-up. Auth submit handlers now live on the web group.

2. **Shape change.** Scaffolded apps now get a real `app/Controllers/AuthController.ts` (extends `BaseAuthController`) instead of ~60 lines inlined in `routes/web.ts`. `routes/web.ts` shrinks to `registerAuthRoutes(Route, { middleware: webMw })` (GETs) + `Route.registerController(AuthController)` (POSTs). Welcome page uses the cleaner `auth().user()` helper — no manual `runWithAuth` / `app().make<AuthManager>()` wrapping.

Customization path: edit `app/Controllers/AuthController.ts` — subclass `BaseAuthController` methods you want to change, or add new ones. The class-level `@Middleware([authLimit])` decorator applies rate limiting to every POST.
