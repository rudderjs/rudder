---
"create-rudder": patch
---

Fix `db:generate`/`db:push` failing in scaffolded apps on **pnpm 11**. The
generated `pnpm-workspace.yaml` (emitted to keep the app a standalone workspace)
only contained `packages: []`. pnpm 11 reads the `onlyBuiltDependencies`
allowlist from `pnpm-workspace.yaml` — not `package.json#pnpm` — so its presence
meant the allowlist was ignored and **no dependency build scripts ran**
(`better-sqlite3`'s native binding, Prisma's engine), leaving the database
unusable and surfacing `ERR_PNPM_IGNORED_BUILDS`. The allowlist now lives in
`pnpm-workspace.yaml` too (still mirrored in `package.json#pnpm` for older pnpm).
