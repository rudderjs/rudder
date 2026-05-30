---
"create-rudder": patch
---

Fix `db:generate`/`db:push`/`dev` failing in scaffolded apps on **pnpm 11**
(`ERR_PNPM_IGNORED_BUILDS`). pnpm 10+ blocks dependency build scripts by default,
so the SQLite native binding (`better-sqlite3`), the Prisma engine and `esbuild`
never built. The generated `pnpm-workspace.yaml` now sets
`dangerouslyAllowAllBuilds: true` — verified to run build scripts on both pnpm 10
and 11 (an `onlyBuiltDependencies` allowlist is *not* honored for a standalone
app on pnpm 11, and `package.json#pnpm` is ignored there entirely, so the dead
field was dropped). A scaffolded app's dependencies are all framework-curated,
and npm/yarn run every postinstall by default anyway.
