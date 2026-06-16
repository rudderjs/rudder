---
"@rudderjs/cli": minor
---

feat(doctor): add four preflight checks for common setup cliffs

`rudder doctor` gains four fast-path (no-boot) checks that catch misconfigurations which otherwise fail late with cryptic runtime errors:

- **`structure:reflect-metadata`** — errors when `bootstrap/app.ts` does not `import 'reflect-metadata'` (DI and decorators silently break without it).
- **`structure:tsconfig-decorators`** — verifies `experimentalDecorators` and `emitDecoratorMetadata` are enabled, resolving the `extends` chain (JSONC-tolerant). Warns rather than errors when an extended tsconfig can't be read.
- **`deps:single-orm-driver`** — warns when more than one `@rudderjs/orm-*` adapter is installed (one is selected silently); points to `DB_DRIVER` / `config('database.driver')`.
- **`deps:single-vike-renderer`** — errors when more than one Vike renderer (`vike-react` / `vike-vue` / `vike-solid`) is installed (the view scanner needs exactly one), with the exact `pnpm remove` command to fix it.
