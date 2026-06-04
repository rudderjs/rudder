// Direct-relation eager loading on the NATIVE engine.
//
// The native adapter can't resolve a direct relation from a name alone (the
// adapter contract passes relation NAMES only, no join shape), so historically
// `Model.with('relation')` was a dev-warn no-op. The adapter now advertises
// `eagerLoadStrategy = 'model-layer'` (same as Drizzle, #829), so the ORM
// resolves direct relations in its Model layer: one batched WHERE-IN query per
// relation, stitched onto each parent. These tests prove that end-to-end
// against in-memory SQLite for every direct relation type — hasMany, hasOne,
// belongsTo, belongsToMany. Mirrors orm-drizzle/src/eager-with.test.ts.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

// ─── Models ─────────────────────────────────────────────────────────────────

class Profile extends Model {
  static override table = 'profiles'
  id!: number
  userId!: number
  bio!: string
}
class Post extends Model {
  static override table = 'posts'
  static override relations = {
    author: { type: 'belongsTo' as const, model: () => User },
  }
  id!: number
  userId!: number
  title!: string
}
class Role extends Model {
  static override table = 'roles'
  id!: number
  name!: string
}
class User extends Model {
  static override table = 'users'
  static override relations = {
    posts:   { type: 'hasMany' as const, model: () => Post },
    profile: { type: 'hasOne' as const, model: () => Profile },
    roles:   { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
  }
  id!: number
  name!: string
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE users    (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`, [])
  await driver.execute(`CREATE TABLE profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, bio TEXT NOT NULL)`, [])
  await driver.execute(`CREATE TABLE posts    (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, title TEXT NOT NULL)`, [])
  await driver.execute(`CREATE TABLE roles    (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)`, [])
  await driver.execute(`CREATE TABLE role_user(userId INTEGER NOT NULL, roleId INTEGER NOT NULL)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))

  const ada = await User.create({ name: 'Ada' })
  const bob = await User.create({ name: 'Bob' })
  await User.create({ name: 'Cleo' }) // no relations at all

  await Profile.create({ userId: ada.id, bio: 'mathematician' })

  await Post.create({ userId: ada.id, title: 'Notes I' })
  await Post.create({ userId: ada.id, title: 'Notes II' })
  await Post.create({ userId: bob.id, title: 'Hello' })

  const admin  = await Role.create({ name: 'admin' })
  const editor = await Role.create({ name: 'editor' })
  await ModelRegistry.getAdapter().query('role_user').create({ userId: ada.id, roleId: admin.id })
  await ModelRegistry.getAdapter().query('role_user').create({ userId: ada.id, roleId: editor.id })
  await ModelRegistry.getAdapter().query('role_user').create({ userId: bob.id, roleId: editor.id })
})

afterEach(async () => { await driver.close() })

describe('native eager loading — strategy flag', () => {
  it('the adapter advertises the model-layer strategy', () => {
    assert.equal(ModelRegistry.getAdapter().eagerLoadStrategy, 'model-layer')
  })
})

describe('native eager loading — hasMany', () => {
  it('attaches the related collection to each parent (batched)', async () => {
    const all = await User.query().with('posts').orderBy('id', 'ASC').get()
    const byName = Object.fromEntries(all.map(u => [u.name, u]))

    const adaPosts = (byName['Ada'] as unknown as { posts: Post[] }).posts
    assert.deepEqual(adaPosts.map(p => p.title).sort(), ['Notes I', 'Notes II'])
    assert.ok(adaPosts.every(p => p instanceof Post), 'related rows are Model instances')

    assert.deepEqual((byName['Bob'] as unknown as { posts: Post[] }).posts.map(p => p.title), ['Hello'])
    // A parent with no children gets an empty array, not undefined.
    assert.deepEqual((byName['Cleo'] as unknown as { posts: Post[] }).posts, [])
  })

  it('works on a single-row terminal (first)', async () => {
    const ada = await User.query().where('name', 'Ada').with('posts').first()
    assert.equal((ada as unknown as { posts: Post[] }).posts.length, 2)
  })

  it('works via the Model static entry point', async () => {
    const all = await User.with('posts').orderBy('id', 'ASC').get()
    assert.equal((all[0] as unknown as { posts: Post[] }).posts.length, 2)
  })
})

describe('native eager loading — hasOne', () => {
  it('attaches the single related row, or null when absent', async () => {
    const all = await User.query().with('profile').orderBy('id', 'ASC').get()
    const byName = Object.fromEntries(all.map(u => [u.name, u]))

    const adaProfile = (byName['Ada'] as unknown as { profile: Profile | null }).profile
    assert.ok(adaProfile instanceof Profile)
    assert.equal(adaProfile!.bio, 'mathematician')

    assert.equal((byName['Bob'] as unknown as { profile: Profile | null }).profile, null)
  })
})

describe('native eager loading — belongsTo', () => {
  it('resolves the parent by foreign key', async () => {
    const all = await Post.query().with('author').orderBy('id', 'ASC').get()
    assert.equal(all.length, 3)
    for (const post of all) {
      const author = (post as unknown as { author: User | null }).author
      assert.ok(author instanceof User)
    }
    const titles = Object.fromEntries(all.map(p => [p.title, (p as unknown as { author: User }).author.name]))
    assert.equal(titles['Notes I'], 'Ada')
    assert.equal(titles['Hello'], 'Bob')
  })
})

describe('native eager loading — belongsToMany', () => {
  it('attaches related rows through the pivot table', async () => {
    const all = await User.query().with('roles').orderBy('id', 'ASC').get()
    const byName = Object.fromEntries(all.map(u => [u.name, u]))

    const adaRoles = (byName['Ada'] as unknown as { roles: Role[] }).roles
    assert.deepEqual(adaRoles.map(r => r.name).sort(), ['admin', 'editor'])
    assert.ok(adaRoles.every(r => r instanceof Role))

    assert.deepEqual((byName['Bob'] as unknown as { roles: Role[] }).roles.map(r => r.name), ['editor'])
    assert.deepEqual((byName['Cleo'] as unknown as { roles: Role[] }).roles, [])
  })
})

describe('native eager loading — composition + errors', () => {
  it('loads several relations in one call', async () => {
    const ada = await User.query().where('name', 'Ada').with('posts', 'profile', 'roles').first()
    const a = ada as unknown as { posts: Post[]; profile: Profile | null; roles: Role[] }
    assert.equal(a.posts.length, 2)
    assert.ok(a.profile instanceof Profile)
    assert.equal(a.roles.length, 2)
  })

  it('composes with whereHas (filter + load on the same query)', async () => {
    const withPosts = await User.query().whereHas('posts').with('posts').orderBy('id', 'ASC').get()
    assert.deepEqual(withPosts.map(u => u.name), ['Ada', 'Bob'])
    assert.equal((withPosts[0] as unknown as { posts: Post[] }).posts.length, 2)
  })

  it('works on paginate()', async () => {
    const page = await User.query().with('posts').orderBy('id', 'ASC').paginate(1, 2)
    assert.equal(page.data.length, 2)
    assert.equal((page.data[0] as unknown as { posts: Post[] }).posts.length, 2)
  })

  it('throws a clear error for an undeclared relation', async () => {
    await assert.rejects(
      User.query().with('nope').get(),
      /no relation named "nope" is declared on static relations/,
    )
  })
})
