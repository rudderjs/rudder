---
"create-rudder-app": minor
---

**Scaffold a shared `SiteHeader` component and fix two latent hydration / CSRF bugs.**

New single-framework scaffolds now ship `app/Components/SiteHeader.{tsx,vue}` — a shared header that reads the current user from `pageContext` (set by `@rudderjs/auth`'s enhancer) and owns the brand, Demos link, Login/Register links, and sign-out button. `Welcome.{tsx,vue}` and every demo view drop their inline `<nav className="page-nav">` block and use `<SiteHeader />` instead. The welcome route handler no longer resolves the current user or passes `loginUrl`/`registerUrl` props — `SiteHeader` sources them itself. Three framework variants (React / Vue / Solid), each with an auth-installed and a no-auth branch.

Two bug fixes ride along:

- **`pages/+config.ts` now lists `'user'`, `'locale'`, `'flash'` in `passToClient`.** Without this, the `@rudderjs/vite` pageContext enhancers drop on hydration: any view reading `usePageContext().user` rendered signed-in on the server and signed-out on the client, causing a visible flicker the moment React/Vue hydrated.

- **Sign-out fetch now sends `X-CSRF-Token`** via `getCsrfToken()` from `@rudderjs/middleware/client`. The previous request was silently rejected by `CsrfMiddleware` on the web group (419), but the page reloaded as if it had worked, so the session wasn't actually destroyed. Applied to both the single-framework Welcome path and the multi-framework `pages/index/+Page.{tsx,vue}` path.

Existing scaffolded apps are unaffected — files are captured at scaffold time. To pull these into an existing app, vendor `SiteHeader.tsx` from a fresh scaffold, add `passToClient: ['user', 'locale', 'flash']` to `pages/+config.ts`, and patch the sign-out fetch with `X-CSRF-Token`.
