---
name: auth-setup
description: Setting up authentication with guards, sessions, registration, password reset, gates/policies, and vendor views in RudderJS
license: MIT
appliesTo:
  - '@rudderjs/auth'
trigger: configuring guards/providers in `config/auth.ts`, vendoring auth views, wiring `Gate`/`Policy`, or working with password reset / email verification
skip: a route handler that just reads `Auth.user()` — no setup needed
metadata:
  author: rudderjs
---

# Auth Setup

## When to use this skill

Load when you're configuring guards/providers, vendoring auth views, wiring `Gate`/`Policy` authorization, or working with password reset / email verification. For depth, open the rule file matching your task.

## Quick Reference

| Task | Open |
|---|---|
| Provider setup — install deps, `config/auth.ts`, register provider, make User authenticatable | `rules/provider-setup.md` |
| Reading the current user — `auth()`, `Auth` facade, `RequireAuth` / `RequireGuest` middleware, login/logout endpoints | `rules/guards-and-handlers.md` |
| Login / register UI — `vendor:publish` auth views, `registerAuthRoutes`, custom paths and view ids | `rules/auth-views.md` |
| Authorization — `Gate.define`, model `Policy` classes, `before` callbacks | `rules/gates-and-policies.md` |
| Email verification + password reset — `MustVerifyEmail`, `verificationUrl`, `PasswordBroker` | `rules/email-and-password-reset.md` |

## Key concepts (load once)

- **AuthManager** — process-wide DI singleton that creates fresh `SessionGuard` instances per call. **Never cached** — cached guards leak `_user` across requests.
- **`auth()` helper** — Laravel-style accessor returning the request-scoped `AuthManager` via AsyncLocalStorage.
- **`Auth` facade** — `Auth.user()`, `Auth.check()`, etc. — static class that proxies to `currentAuth()`.
- **Middleware groups** — `AuthMiddleware` auto-installs on the `web` group only. API routes are stateless by default; use `RequireBearer()` + `scope(...)` (passport) for token auth per-route.
- **`SessionGuard.user()` soft-fails** — returns `null` (not throw) when there's no ALS context, matching Laravel's `Auth::user()` semantics.
- **Peer deps**: `@rudderjs/session` and `@rudderjs/hash` are **required peers**. `HashProvider` must boot before `AuthProvider` (`defaultProviders()` orders this automatically).

## Examples

See `playground/config/auth.ts`, `playground/app/Models/User.ts`, `playground/routes/web.ts`, and `playground/app/Views/Auth/`.
