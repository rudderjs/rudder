---
"@rudderjs/orm-prisma": patch
---

fix(doctor): `orm-prisma:client-generated` now finds the real generated client directory

Previously the check stat'd `node_modules/@prisma/client/package.json` for its mtime. Under Prisma 7 + pnpm, that file is the symlinked package metadata — `prisma generate` never touches it. The check reported "stale" after every regenerate even when the client was current.

The check now:

1. Honors `generator <name> { output = "..." }` declared in any schema (Prisma 7's `prisma-client` generator path; resolved relative to the schema's directory per Prisma docs).
2. Falls back to the resolved `@prisma/client`'s sibling `.prisma/client/` — works for both pnpm (real path is `.pnpm/<id>/node_modules/@prisma/client/`, sibling at `.pnpm/<id>/node_modules/.prisma/client/`) and npm/yarn flat layouts.
3. Falls back to the legacy hoisted `node_modules/.prisma/client/`.

Staleness is now decided by the newest file mtime in the resolved directory — matches what `prisma generate` actually writes. `--fix` already worked correctly; this brings the check in line.
