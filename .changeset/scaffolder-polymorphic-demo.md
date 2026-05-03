---
"create-rudder-app": minor
---

Add `polymorphic` to the demo multiselect (gated on ORM, parallel to `todos`). Selecting it scaffolds Post/Video/Comment models with `morphMany`/`morphTo` relations, the Prisma block (camelCase `commentableId`/`commentableType` + index), the `/demos/polymorphic` controller, and six API endpoints exercising `Model.morph()` writes + `morphTo` resolution against a closed `types: () => [Post, Video]` list. Mirrors the playground demo from rudder #197.
