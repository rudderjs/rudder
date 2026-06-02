---
"@rudderjs/orm": minor
---

Native engine schema/migration breadth (Laravel parity). The `@rudderjs/orm/native` schema builder gains:

- **`morphs()` / `nullableMorphs()` / `dropMorphs()`** — polymorphic-relation column scaffolding (`{name}Id` + `{name}Type` + composite index, camelCase).
- **More column types** — `tinyInteger`/`smallInteger`/`mediumInteger`, `char`, `mediumText`/`longText`, `double`, `date`, `time(precision?)`, `jsonb`, `ulid`, `foreignUuid`/`foreignUlid`/`foreignIdFor`, and `enum`/`set` — mapped across all three native dialects (sqlite/pg/mysql); `set` throws a clear unsupported error on pg/sqlite.
- **Column modifiers** — `comment()` (inline on MySQL, `COMMENT ON COLUMN` on pg), `useCurrentOnUpdate()` (MySQL), `after()`/`first()` (MySQL positional ALTER), raw `Expression` defaults (e.g. `raw('gen_random_uuid()')`), and FK shorthands `cascadeOnDelete()` / `restrictOnDelete()` / `nullOnDelete()` / `cascadeOnUpdate()`.
- **Migrate command flags** — `migrate --step`/`--pretend`/`--force`, `migrate:rollback --step[=N]`/`--batch=N`, standalone `migrate:reset`, `migrate:refresh --step`/`--seed`, and `migrate:fresh --seed`.
