---
'@rudderjs/console': patch
'create-rudder-app': patch
---

Fix `pnpm rudder <any-command>` crashing in production with
`cannot add command 'db:seed' as already have command 'db:seed'`.

Root cause: two registrations of `db:seed` landed on the global `rudder`
CommandRegistry — one from `@rudderjs/orm`'s built-in `db:seed` (resolves
`database/seeders/DatabaseSeeder.{ts,js,mts,mjs}`) and one from the
scaffolded `routes/console.ts` stub. `CommandRegistry#command()` push-appended
without dedup, both survived to the commander.js layer, and commander threw
on the second registration. Development masked the collision because
`@rudderjs/core`'s `_bootstrapProviders()` calls `rudder.reset()` between
the package-command load phase and the route-loader phase — but only when
`isDevelopment()`. Production skipped the reset, so the crash only surfaced
after deploy.

What changes:

- `create-rudder-app`: scaffolded `routes/console.ts` no longer emits a
  `rudder.command('db:seed', ...)` TODO stub. A short comment points users
  at the framework-provided pattern instead — drop a default-exported
  `Seeder` subclass at `database/seeders/DatabaseSeeder.ts`. The framework's
  `db:seed` (from `@rudderjs/orm`) auto-resolves and runs it.

- `@rudderjs/console`: `CommandRegistry#command()` now uses last-writer-wins
  semantics. If a command name is registered twice, the second registration
  replaces the first and a `console.warn` describes the override. This
  prevents the entire class of bug for any future framework-vs-user command
  collision (e.g. user-override of `route:list`, `make:migration`, etc.)
  rather than fixing just `db:seed`.

Surfaced 2026-05-20 by pilotiq-io's production boot — caught only because
the smoke test ran `pnpm rudder inspire` in NODE_ENV=production after deploy.

No public API change. Existing user code that registers unique command
names is unaffected.
