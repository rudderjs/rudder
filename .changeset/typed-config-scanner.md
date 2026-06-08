---
"@rudderjs/vite": minor
"@rudderjs/cli": minor
---

Auto-generate the typed `config()` registry — no more hand-written `AppConfig` augmentation.

`@rudderjs/core` already types `config('section.key')` over an `AppConfig` interface, but apps had to hand-write `declare module '@rudderjs/core' { interface AppConfig extends typeof configs {} }` to populate it. A new config scanner (sibling to the typed-env scanner) emits `.rudder/types/config.d.ts` augmenting `AppConfig` from the app's `config/index.ts` barrel via `import type` — so `config('app.name')` autocompletes and returns the real section type with zero boilerplate.

The scanner runs in the same Vite generation pass as the env/routes scanners (dev + build), and ships a skip-boot `rudder config:sync` command to regenerate on demand. A missing `config/index.ts` removes any stale emit (symmetric shrink). Like the other registries, `.rudder/types/config.d.ts` is committed so `tsc` stays green on fresh clones.
