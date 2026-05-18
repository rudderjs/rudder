---
'create-rudder-app': minor
'@rudderjs/cli': patch
---

Make the scaffolder magical — turn the first 60 seconds with RudderJS into "scaffold → working app" instead of "scaffold → copy 4–5 commands → working app".

## What changed in `create-rudder-app`

- **Recipe picker** replaces the 25-option package multiselect. One question — _"What are you building?"_ — picks from `web-app` / `saas` / `api-service` / `realtime` / `minimal` / `custom`. The Custom escape hatch preserves the full multiselect for power users.
- **Frontend prompts collapsed**: 4 prompts (frameworks multi, primary, tailwind, shadcn) → 2 (framework single-select, styling single-select). Both auto-skipped for `api-service` and `minimal`.
- **Demos dropped from the default scaffold.** The 15-option demo multiselect is gone; nothing scaffolds into `app/Views/Demos/`. The demos still live in the framework playground and at `rudderjs.com/examples` — link printed in the final panel.
- **Auto-cascade after install** — what used to be 4–5 manual commands in the "Next Steps" panel now runs automatically:
  - `pnpm rudder db:generate` (always — no-op for Drizzle)
  - `pnpm rudder db:push` (SQLite by default; for Postgres/MySQL the scaffolder asks _"Is your DB running now?"_ first, falls through to manual steps if no)
  - `pnpm rudder vendor:publish --tag=auth-views-<framework>` (only if `@rudderjs/auth` couldn't vendor views via `fs.cp` — fallback path)
  - `pnpm rudder passport:keys` (only when passport is selected)
- **`git init` + initial commit** — runs by default after the cascade (`--git=false` to skip). Skipped silently if `git` isn't on `$PATH` or `.git/` already exists.
- **Final panel slimmed down**: when the auto-cascade succeeds end-to-end, the panel prints exactly one line — `cd app && pnpm dev`. When something needed user attention (DB not running, command failed), only the remediation steps appear.

## New flags

| Flag | What it does |
|---|---|
| `--recipe=<name>` | Preset bundle. Drives ORM default + packages + whether frontend prompts appear. |
| `--framework=react\|vue\|solid\|none` | Singular shortcut — replaces `--frameworks` + `--primary-framework` for the common case. |
| `--styling=tailwind+shadcn\|tailwind\|plain` | Single styling choice — collapses `--tailwind` + `--shadcn`. |
| `--git=true\|false` | Whether to run `git init` after scaffolding (default `true`). |
| `--db-ready=true\|false` | Pre-answer the "Is your DB running?" prompt; only matters for Postgres/MySQL. |

## Backward compatibility

All old flags (`--orm`, `--packages`, `--frameworks`, `--primary-framework`, `--tailwind`, `--shadcn`, `--demos`, `--install`) still parse and validate. JSON mode supports both shapes — either the new recipe-driven contract or the pre-recipe explicit contract. The `--demos` flag is now a silent no-op (demos were dropped from the default scaffold) — existing scripts and CI passing `--demos=...` keep working without modification.

## What changed in `@rudderjs/cli`

Added `db:generate`, `db:push`, `migrate`, `migrate:fresh`, `migrate:status` to the CLI's skip-boot list. These commands all shell out to the underlying ORM binary (Prisma / drizzle-kit) and never touch app state.

This is load-bearing for the create-rudder-app auto-cascade: `rudder db:generate` MUST work _before_ `@prisma/client` has been generated, which is exactly the chicken-and-egg the framework boot would hit on a fresh scaffolded project. Without this, `pnpm rudder db:generate` on a fresh app fails with `Could not load @prisma/client` because the framework's `DatabaseProvider` boots before generation runs. (`db:seed` is deliberately not in skip-boot — user seeders use the ORM and need a booted app.)
