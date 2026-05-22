---
"@rudderjs/cli": patch
---

`rudder routes:sync` from `@rudderjs/vite/commands/routes-sync` is now picked up by the CLI loader and added to the skip-boot list. Regenerates `pages/__view/routes.d.ts` from `routes/*.ts` without booting the app — useful in CI and on fresh clones.
