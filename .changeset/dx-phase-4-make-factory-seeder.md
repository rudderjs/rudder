---
"@rudderjs/orm": minor
"@rudderjs/cli": patch
---

feat: `make:factory` + `make:seeder` scaffolders, plus dev-mode loader fix

Completes the `make:*` family. Both scaffolders mirror existing patterns (`make:migration` / `make:agent` / `make:terminal`):

```bash
$ pnpm rudder make:factory User
✓ Factory created: app/Factories/UserFactory.ts

$ pnpm rudder make:seeder Users
✓ Seeder created: database/seeders/UsersSeeder.ts
```

Generated stubs match the **real** `ModelFactory` + `Seeder` abstract-class APIs (not the `Factory.define()` callback shape the plan doc misremembered): subclass + `protected modelClass` + `definition()` for factories, subclass + `async run()` for seeders. Factory stems infer the model name (`UserFactory` imports `User`). Seeder stems show the matching `<Name>Factory` import + `this.call(...)` composition example commented out.

Phase 4 of the DX-completion roadmap (`docs/plans/2026-05-20-dx-completion.md`). Final phase — all four DX gaps now closed.

## Bundled fix (load-bearing): `loadPackageCommands` cwd-walks

The cli's `tryImport(pkg, subpath)` was building bare specifiers (`<pkg>/<subpath>`) and dispatching to `import()`. When the cli runs in dev mode via `tsx node_modules/@rudderjs/cli/src/index.ts` (the pnpm symlink target), Node resolves those specifiers relative to the SOURCE file — `packages/cli/src/`, where pnpm-strict has no peer-package entries. The catch in `Promise.all(loaders.map(fn => fn().catch(() => {})))` silently swallowed every failure. **Every package-contributed `make:*` was a no-op in dev:** `make:agent`, `make:mcp-tool`, `make:terminal`, `make:migration` — all silently broken.

Phase 4 surfaced it (my new `make:factory` wasn't registering); without the fix, this PR ships a non-functional scaffolder. Bundled per the load-bearing-fix rule.

Fix: walk `<cwd>/node_modules/<pkg>/dist/<subpath>.js` directly + `pathToFileURL` for Windows portability. Same shape doctor's `load-package-checks.ts` already uses for the identical reason.
