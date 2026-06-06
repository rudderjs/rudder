---
"@rudderjs/cli": patch
---

`module:publish` now merges module Prisma shards into `prisma/schema/modules.prisma` when the app uses Prisma's multi-file layout (the scaffolder default — `prisma.config.ts` points `schema` at the `prisma/schema/` directory). Previously it always wrote a sibling `prisma/schema.prisma`, a file Prisma never reads on that layout, so the publish was a silent no-op for every scaffolded app. Legacy single-file projects keep the `prisma/schema.prisma` target.
