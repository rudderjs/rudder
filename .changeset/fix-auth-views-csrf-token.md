---
'@rudderjs/auth': patch
---

Auth views now send `X-CSRF-Token` on form submission

The vendored React views (`Login`, `Register`, `ForgotPassword`,
`ResetPassword`) under `views/react/` previously POST'd credentials
without a CSRF token. Now that `CsrfMiddleware` runs on the `web` group
by default (the routes registered by `registerAuthRoutes()` live on the
web group), every POST needs to send the token.

The views now import `getCsrfToken` from `@rudderjs/middleware` and
attach `X-CSRF-Token` to the `fetch()` headers. Existing apps that
vendored the previous views continue to work — they just need to either
re-vendor (`cp -R node_modules/@rudderjs/auth/views/react/. app/Views/Auth/`)
or add the header themselves.
