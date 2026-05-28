---
'@rudderjs/orm': patch
---

`make:factory` paired with `make:model` of the same name didn't compile — the factory stub declared `extends ModelFactory<{ name: string; email: string }>`, but `make:model` emits a class with no field declarations, so `Partial<InstanceType<typeof Model>>` (what `Model.create` accepts) had no `name`/`email` keys. TypeScript failed function-parameter contravariance on `modelClass = <Model>` and surfaced `TS2416: Property 'modelClass' is not assignable …`.

Switched the stub's initial generic to `ModelFactory<any>` so the default `make:model X; make:factory X` pair compiles out of the box. A multi-line comment in the stub explains why and points at the concrete shape the user should tighten to once the model's fields are declared (e.g. `ModelFactory<{ name: string; email: string }>` — the documented pattern). The `any` is intentionally scaffolded-only — `definition()` and the `Model.create` call site still constrain the runtime data. An `// eslint-disable-next-line @typescript-eslint/no-explicit-any` keeps the stub lint-clean. Found by the Phase 1 scaffolder audit.
