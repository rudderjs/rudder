---
"@rudderjs/orm": patch
---

Dev HMR: `ModelRegistry.register()` now re-points at a re-imported model class instead of silently ignoring it.

A dev re-boot re-evaluates `app/Models/*.ts`, producing a new class identity with the same `name`. The old guard (`_store.models.has(name)`) ignored it — leaving the registry pointed at the stale class and the fresh class's `belongsToMany`/morph accessors never installed on its prototype. A consumer that introspects the model (e.g. a resource schema-builder walking relations) then sees a half-wired model and can produce an incomplete schema persistently, with no self-recovery. A same-name but different-identity registration now updates the map and re-installs the accessors on the fresh prototype. No-op in production (a model is imported once, so the identity never differs) and for the exact same class.
