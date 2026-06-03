---
'@rudderjs/orm': minor
'@rudderjs/cli': minor
---

New `make:resource` scaffolder — `pnpm rudder make:resource User` writes `app/Resources/UserResource.ts` with a `JsonResource` subclass stub (inferred model import, `toArray()` body, conditional-helper examples). Spec lives at `@rudderjs/orm/commands/make-resource` (same MakeSpec pattern as `make:factory`/`make:seeder`); the CLI loader registers it automatically.
