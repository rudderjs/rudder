---
'@rudderjs/orm':         minor
'@rudderjs/orm-prisma':  minor
'@rudderjs/orm-drizzle': minor
'@rudderjs/contracts':   patch
---

feat(orm): `belongsToMany` (many-to-many) relations

Many-to-many is now first-class. Declare on `static relations` with `pivotTable` (required) and call `parent.related('roles').get()` for chainable reads through the pivot, or use the per-relation accessor (`user.roles().attach([1,2])`) for pivot mutations.

```ts
class User extends Model {
  static override relations = {
    roles: { type: 'belongsToMany', model: () => Role, pivotTable: 'role_user' },
  } as const
}

await user!.related('roles').where('active', true).get()
await user!.roles().attach([1, 2], { addedBy: 'admin' })
await user!.roles().attach({ 1: { addedBy: 'admin' }, 2: { addedBy: 'system' } })
await user!.roles().sync([1, 3, 5])  // → { attached: [3, 5], detached: [2] }
await user!.roles().detach()
```

**Adapter contract additions** (`@rudderjs/contracts` patch — additive only, no breaks):

- `QueryBuilder.insertMany(rows)` — bulk insert, no return value.
- `QueryBuilder.deleteAll()` — delete every row matching the chained wheres, returns count.

Both `@rudderjs/orm-prisma` and `@rudderjs/orm-drizzle` implement the new methods. Third-party adapters need to add them; the existing surface is unchanged.

**v1 limitations** (gated on real demand): pivot columns are not surfaced on read results, no `withTimestamps`, no polymorphic `morphToMany`. The deferred read query throws on mutation methods (`create`/`update`/`delete`/`insertMany`/`deleteAll`) — write the pivot via the accessor and the related rows via the related model directly.
