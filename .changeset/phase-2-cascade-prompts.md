---
"create-rudder-app": minor
---

feat: cascade-aware prompt flow + categorized package multiselect (Phase 2)

The package selection step now renders 25 packages across 8 categories
(Auth & Users / Infrastructure / Communication / AI / Internationalization /
Product & Features / Observability / Utilities) using clack's
`groupMultiselect`. ORM=none filters out database-dependent rows
(auth/sanctum/passport/cashier-paddle) before render.

**Tier A silent install**: `@rudderjs/session`, `@rudderjs/hash`, and
`@rudderjs/cache` are now installed unconditionally. They're peers of Auth
and required by the default bootstrap's RateLimit middleware — making them
silent prevents broken projects when Auth is unticked.

**11 new packages** wired into the multiselect (deps + configs):
sanctum, socialite, image, http, process, concurrency, pulse, horizon,
crypt, cashier-paddle, pennant.

**Demos extracted into a dedicated step**: replaces `packages.demos: boolean`
with a top-level `demos: string[]`. The new "Select demos" prompt appears
after the styling step and only shows demos whose package gates are
satisfied (e.g. WebSocket chat hidden when Broadcast isn't selected).

New env keys added when their package is selected:
`APP_KEY` (crypt, auto-generated 32-byte base64), GitHub/Google OAuth
(socialite), Paddle (cashier-paddle).
