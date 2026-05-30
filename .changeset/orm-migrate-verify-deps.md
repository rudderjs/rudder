---
"@rudderjs/orm": patch
---

Make `migrate` / `db:generate` / `db:push` resilient to pnpm 11's
`verify-deps-before-run` deps-status check, which fatally exits
(`ERR_PNPM_IGNORED_BUILDS`) when any dependency has an un-approved build script
(e.g. a transitive `msw` postinstall) — aborting the Prisma/Drizzle command
before it runs. The CLI now passes `--config.verify-deps-before-run=false` to its
`pnpm exec` invocations; the dependencies were already installed.
