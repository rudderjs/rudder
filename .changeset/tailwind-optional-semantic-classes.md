---
"create-rudder-app": patch
"@rudderjs/auth": minor
---

Make Tailwind optional in create-rudder-app and refactor auth views to semantic class names.

`create-rudder-app` now ships two `app/index.css` variants from a single JSX source: a Tailwind `@apply` version (default) and a hand-authored plain CSS version with CSS variables + `prefers-color-scheme` dark mode. Answer "No" to the `Add Tailwind CSS?` prompt to scaffold a zero-Tailwind project that still looks styled out of the box — landing page, auth forms, and error page all render against the plain variant.

`@rudderjs/auth` React views (Login / Register / ForgotPassword / ResetPassword) are refactored to use the same semantic vocabulary (`auth-wrap`, `form-card`, `form-input`, `auth-link`, …). The visual output is unchanged for Tailwind apps; apps that vendored the previous React auth views will need to re-vendor (`pnpm rudder vendor:publish --tag=auth-views --force` or copy from `node_modules/@rudderjs/auth/views/react/`) and either keep Tailwind or bring their own CSS for the new selectors.
