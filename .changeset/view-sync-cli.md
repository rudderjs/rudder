---
'@rudderjs/vite': minor
'@rudderjs/cli': minor
---

Add `rudder view:sync` command that regenerates `pages/__view/` (Vike stubs + `registry.d.ts` + `+config.ts`) from `app/Views/` without starting Vite. Useful when `tsc` runs in CI before any Vite step (typecheck-before-build order), on a fresh clone before the first dev server boot, or after manually clearing `pages/__view/`. Idempotent — safe to call repeatedly. Pass `--json` for machine-readable output.

Also exposes `syncViewsFromDisk()` from `@rudderjs/vite/commands/view-sync` for programmatic use by tooling that needs to materialize the registry without booting the dev server.

`view:sync` skips `bootApp()` (same pattern as `providers:discover`) so it works on apps that can't yet boot — exactly the scenarios it's designed for.
