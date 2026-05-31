---
'@rudderjs/orm': minor
'@rudderjs/cli': patch
---

feat(orm): generated model types — `Model.for<'table'>()` binding + `rudder schema:types` (GATE 7-types)

Finishes the GATE 7-types consumption layer on top of the #817 generator. A model can now derive its column types from the migrated schema with zero hand-declared fields:

```ts
export class User extends Model.for<'users'>() {
  static override table = 'users'
}

await User.find(1)                       // u.id / u.name / u.email — typed
await User.where('active', true).first() // chains are typed too
await User.create({ name, email })       // unknown columns fail tsc
```

- `Model.for<TName>()` resolves a model's instance type from `SchemaRegistry[TName]` (open-decision #1 → generic binding). Purely additive: `static casts` still refine the storage type, plain `extends Model` and hand-declared fields are unaffected.
- `rudder schema:types` regenerates `app/Models/__schema/registry.d.ts` on demand (native engine; boots on demand like `migrate*`).
- Native `migrate` / `migrate:fresh` / `migrate:refresh` / `migrate:rollback` auto-regenerate the registry after a successful apply.
- The generated `registry.d.ts` should be **committed** (so `tsc`/CI is green without a generate step).
