---
'@rudderjs/auth': major
'create-rudder-app': patch
---

`BaseAuthController` is now mounted at `/auth/*` instead of `/api/auth/*` (BREAKING).

The `/api/*` namespace is reserved for token-based API auth (Sanctum / Passport bearer routes); session-based auth lives on the `web` middleware group, matching Laravel's `/login` convention. The previous `/api/auth/*` prefix was a footgun — the URL implied the controller belonged in `routes/api.ts`, but its handlers depend on session/auth ALS context that's only auto-installed on the `web` group.

What changed:

- `@Controller('/api/auth')` → `@Controller('/auth')` on `BaseAuthController`. Subclasses inherit the new prefix.
- The published auth views (`Login`, `Register`, `ForgotPassword`, `ResetPassword`) now default `submitUrl` to `/auth/sign-in/email` / `/auth/sign-up/email` / `/auth/request-password-reset` / `/auth/reset-password`.

Upgrading an existing app:

- If you vendored `@rudderjs/auth/views/react/*` into `app/Views/Auth/`, re-publish them (or do a quick find-and-replace from `/api/auth/` → `/auth/` on those files).
- If you call `BaseAuthController` directly without any subclass URL override, you don't need to do anything else — the controller now serves `POST /auth/sign-in/email` etc. and the bundled views point at the new paths by default.
- If you depend on the old `/api/auth/*` paths (e.g. external mobile clients, custom front-ends), pass explicit `submitUrl` props to the auth views, or add backwards-compatible alias routes in your `routes/web.ts`.

`create-rudder-app`'s Welcome view + scaffolded `pages/index` sign-out fetch are updated to match the new paths.
