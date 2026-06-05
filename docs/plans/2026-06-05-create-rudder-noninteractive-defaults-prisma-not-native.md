# create-rudder: non-interactive recipes scaffold Prisma, docs say native is the default

**Filed by:** pilotiq (downstream), 2026-06-05
**Affects:** `create-rudder@1.6.0` — flag-driven (agent/CI) flow
**Severity:** confusing for agents/CI; doc-vs-behavior mismatch

## Symptom

Docs (`docs/guide/database.md`, `docs/guide/database/native.md`) say the native
engine "is the default engine scaffolded by `create-rudder`". But the
non-interactive flow:

```bash
npx create-rudder my-app --recipe=web-app --db=sqlite --framework=react --install=true
```

scaffolds **Prisma** (`prisma/schema/`, `@rudderjs/orm-prisma`, `@prisma/client`,
`"dbGenerated": true` in the JSON result). Three paper cuts found while
scaffolding pilotiq-demo:

1. **Recipes derive `orm: 'prisma'`** (`dist/cli-flags.js:84` —
   `packagesFromList(list, partial.orm ?? 'prisma')`). The native default
   apparently only applies to the interactive Database prompt. Getting native
   non-interactively requires knowing the *legacy* `--orm=native` flag, which
   the flag table in `installation.md` doesn't list (only the legacy-shape
   aside mentions it).
2. **`--orm=native` still demands `--db`** even though native pins sqlite
   (`cli-flags.js:186` comments say "--db is never required" for native, but the
   missing-flags error fired until `--db=sqlite` was passed alongside
   `--recipe=web-app --orm=native`). Recipe + legacy-flag mixing seems to skip
   that exemption.
3. **Generated tsconfig lacks `"types": ["vite/client"]`** — anything using
   `import.meta.env` in the app (e.g. pilotiq's generated route functions, or
   any user code) fails `tsc --noEmit` out of the box. The rudder playground's
   own tsconfig carries it; the scaffold template should too.

## Suggested fixes

- Make every recipe derive `orm: 'native'` (matching the documented default),
  or add `--engine`/`--orm` to the documented flag table with native as the
  stated default and prisma/drizzle as the opt-ins.
- Honor the native sqlite-pin in the required-flags validation when `--orm` is
  combined with `--recipe`.
- Add `"types": ["vite/client"]` to the scaffolded tsconfig template.
- README on npm still says "generates the Prisma client, pushes the schema" —
  refresh alongside.
