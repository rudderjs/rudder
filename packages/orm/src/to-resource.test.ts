import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelCollection, JsonResource, ResourceCollection } from './index.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

class BoundUser extends Model {
  static override table = 'users'
  declare id: number
  declare name: string
}

// The widened `T extends object` constraint lets a resource type its model
// directly — this class compiling IS the constraint-widening test.
class UserResource extends JsonResource<BoundUser> {
  toArray() {
    return { id: this.resource.id, name: this.resource.name }
  }
}

class AdminUserResource extends JsonResource<BoundUser> {
  toArray() {
    return { id: this.resource.id, name: this.resource.name, admin: true }
  }
}

// Static set AFTER both classes exist (decl-order: resources usually live in
// their own files; apps assign the static at the bottom or via declaration).
BoundUser.resourceClass = UserResource

class UnboundUser extends Model {
  static override table = 'users'
  declare id: number
  declare name: string
}

const ada = () => BoundUser.hydrate({ id: 1, name: 'Ada' }) as BoundUser
const rows = () => [
  BoundUser.hydrate({ id: 1, name: 'Ada' }) as BoundUser,
  BoundUser.hydrate({ id: 2, name: 'Linus' }) as BoundUser,
]

// ─── toResource() ─────────────────────────────────────────────────────────────

describe('Model.toResource()', () => {
  it('uses the bound static resourceClass', () => {
    const resource = ada().toResource()
    assert.ok(resource instanceof UserResource)
    assert.deepEqual(resource.toArray(), { id: 1, name: 'Ada' })
  })

  it('an explicit class works without any static binding', () => {
    const user = UnboundUser.hydrate({ id: 3, name: 'Grace' }) as UnboundUser
    const resource = user.toResource(UserResource)
    assert.ok(resource instanceof UserResource)
  })

  it('an explicit class overrides the bound static', () => {
    const resource = ada().toResource(AdminUserResource)
    assert.ok(resource instanceof AdminUserResource)
    assert.deepEqual(resource.toArray(), { id: 1, name: 'Ada', admin: true })
  })

  it('throws a pointer error when unbound and no class is passed', () => {
    const user = UnboundUser.hydrate({ id: 3, name: 'Grace' }) as UnboundUser
    assert.throws(
      () => user.toResource(),
      (e: Error) => e.message === '[RudderJS ORM] UnboundUser has no resourceClass — set `static resourceClass = UnboundUserResource` or pass the class: `unboundUser.toResource(UnboundUserResource)`.',
    )
  })

  it('composes with the single-resource envelope', async () => {
    const res = await ada().toResource().toResponse()
    assert.deepEqual(res, { data: { id: 1, name: 'Ada' } })
  })
})

// ─── toResourceCollection() ───────────────────────────────────────────────────

describe('ModelCollection.toResourceCollection()', () => {
  it('uses the bound static resourceClass from the items', async () => {
    const collection = ModelCollection.wrap(rows()).toResourceCollection()
    assert.ok(collection instanceof ResourceCollection)
    assert.deepEqual(await collection.toArray(), [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Linus' },
    ])
  })

  it('an explicit class overrides the bound static', async () => {
    const collection = ModelCollection.wrap(rows()).toResourceCollection(AdminUserResource)
    const out = await collection.toArray()
    assert.equal(out[0]?.['admin'], true)
  })

  it('throws a pointer error when items are unbound and no class is passed', () => {
    const items = [UnboundUser.hydrate({ id: 3, name: 'Grace' }) as UnboundUser]
    assert.throws(
      () => ModelCollection.wrap(items).toResourceCollection(),
      (e: Error) => e.message === '[RudderJS ORM] UnboundUser has no resourceClass — set `static resourceClass = UnboundUserResource` or pass the class: `unboundUsers.toResourceCollection(UnboundUserResource)`.',
    )
  })

  it('an empty collection resolves to an empty data envelope without a class', async () => {
    const collection = ModelCollection.wrap<BoundUser>([]).toResourceCollection()
    assert.deepEqual(await collection.toResponse(), { data: [] })
  })

  it('composes with the Task-2 envelope (toResponse + additional)', async () => {
    const res = await ModelCollection.wrap(rows())
      .toResourceCollection()
      .additional({ status: 'ok' })
      .toResponse()
    assert.deepEqual(res, {
      status: 'ok',
      data: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }],
    })
  })
})
