---
"@rudderjs/cli": minor
---

feat(cli): `rudder tinker` — interactive REPL with the app booted

Laravel `php artisan tinker` equivalent. Drops into a Node REPL after a full app boot; pre-populates the context with the DI container accessor, route helpers, and every model under `app/Models/`. Top-level `await` works; history persists to `~/.rudder-tinker-history`.

```bash
$ pnpm rudder tinker
RudderJS Tinker — node v22.14.0, env=local

> await User.count()
12

> const u = await User.where('email', 'alice@example.com').first()
> u.posts().count()
5

> route('users.show', { id: u.id })
'/users/42'
```

Context entries:

- `app()` — DI container accessor
- `config` — typed config reader
- `Route`, `route()`, `Url` — router + URL helpers (from `@rudderjs/router` when installed)
- `rudder` / `Rudder` — command registry
- Every model class under `app/Models/` (named + default exports)

Flags: `--no-banner`, `--no-history`. Meta-command: `.boot` to re-run the app boot after a code change.

The CLI sets `RUDDERJS_TINKER=1` before booting so providers that actively poll or open connections on `boot()` (`@rudderjs/horizon`'s `WorkerCollector` is the canonical case) can short-circuit. Same shape as the existing `RUDDERJS_QUEUE_WORKER=1` sentinel set for `queue:work` — zero new core API surface.

Phase 1 of the DX-completion roadmap (`docs/plans/2026-05-20-dx-completion.md`). Subsequent phases: editor-launch on error frames, typed `route()` URL generator, `make:factory` + `make:seeder` scaffolders.
