# Authentication

RudderJS ships two native authentication packages. Pick based on how you're authenticating requests, not how you store users.

## [`@rudderjs/auth`](/packages/auth/) — session-based web auth

For traditional server-rendered web apps and dashboards.

- Laravel-style session guards, `Auth` facade, `Gate`/`Policy` authorization
- Auto-installs session + auth middleware on the `web` route group
- Ships publishable login/register/forgot/reset views (React + Vue)
- Password reset broker, email verification, remember tokens
- `req.user` populated on every web request; `auth()` / `Auth::user()` for code paths

Start here for email/password + social OAuth login flows that set a cookie and render authenticated pages.

**Full reference:** [`@rudderjs/auth` package page](/packages/auth/)

## [`@rudderjs/passport`](/packages/passport) — OAuth 2 server + API tokens

For third-party integrations, mobile apps, CLIs, machine-to-machine, and GitHub-style personal access tokens.

- Four OAuth 2 grants — authorization code + PKCE, client credentials, refresh token, device code
- RS256-signed JWT access tokens; third parties can verify without calling your server
- Personal access tokens via the `HasApiTokens` mixin on your User model
- `RequireBearer()` + `scope('read', 'write')` middleware for protecting API routes
- Customization hooks for consent screen, model overrides, selective route registration

Start here when you need token-based API auth on top of (or instead of) session-based web auth.

**Full reference:** [`@rudderjs/passport` package page](/packages/passport)

## Which to use?

Both. A typical RudderJS app uses:

- `@rudderjs/auth` on routes loaded via `withRouting({ web })` — login, dashboard, account pages
- `@rudderjs/passport` on routes loaded via `withRouting({ api })` — public API surface, third-party integrations

Both are native to RudderJS — no third-party auth library required.

## Related guides

- [Middleware](/guide/middleware) — how the `web` / `api` groups drive auth middleware installation
- [Controller Views](/guide/views) — how the scaffolded auth pages plug in via `registerAuthRoutes()`
