---
"@rudderjs/core": patch
---

Fix dev HMR re-boot wedging when `APP_ENV` isn't `development`. The re-boot reset (`router.reset()` + `rudder.reset()` + group-middleware reset) was gated on `isDevelopment()`, which reads `APP_ENV` (default `production`). A `vike dev` server without `APP_ENV=development` (e.g. a fresh checkout with no `.env`, or `APP_ENV=production`) still re-boots on every file edit, but the reset was skipped — leaving the router mounted from the first boot, so a provider that registers routes in `boot()` (e.g. `@rudderjs/horizon`) threw `get() called after router.mount()` on the second edit and wedged the dev server. The reset is now gated on "is this a re-boot" (a previous boot exists) rather than the environment, so shared state is reset before every re-boot regardless of `APP_ENV`. No effect in production (single boot).
