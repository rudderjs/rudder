// ─── Contender: RudderJS native engine ───────────────────────────────────────
// Drives @rudderjs/orm's Model layer over @rudderjs/database's native
// better-sqlite3 driver — the exact path an app uses, minus the HTTP stack.
// Imports resolve to the packages' compiled dist/ (prod builds only).

import { Model, ModelRegistry } from '@rudderjs/orm'
import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/database/native'
import { PRAGMAS } from '../schema.mjs'

export const name = 'rudder'

// Models are defined once; ModelRegistry.set() swaps which adapter (which DB
// file) they read/write on connect — only this contender touches the registry.
class User extends Model {
  static table = 'users'
  static timestamps = false
  static relations = {
    posts: { type: 'hasMany', model: () => Post, foreignKey: 'user_id' },
  }
}
class Post extends Model {
  static table = 'posts'
  static timestamps = false
  static relations = {
    user: { type: 'belongsTo', model: () => User, foreignKey: 'user_id' },
    comments: { type: 'hasMany', model: () => Comment, foreignKey: 'post_id' },
    tags: {
      type: 'belongsToMany',
      model: () => Tag,
      pivotTable: 'post_tags',
      foreignPivotKey: 'post_id',
      relatedPivotKey: 'tag_id',
    },
  }
}
class Comment extends Model {
  static table = 'comments'
  static timestamps = false
}
class Tag extends Model {
  static table = 'tags'
  static timestamps = false
}

export async function connect(file) {
  const driver = await BetterSqlite3Driver.open({ filename: file })
  for (const p of PRAGMAS) await driver.execute(p, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
  return { driver }
}

export async function disconnect(ctx) {
  await ctx.driver.close()
}

export function build(ctx, fx) {
  let pk = 0
  let toJsonRows = null // hydrated once (during warm-up) so the timed run is pure serialization
  return {
    insertSingle: async () => {
      await User.create({ ...fx.newUser })
      return 1
    },
    insertBulk: async () => {
      await User.query().insertMany(fx.bulkRows)
      return fx.bulkRows.length
    },
    findByPk: async () => {
      const id = fx.pkWindow[pk++ % fx.pkWindow.length]
      const u = await User.find(id)
      return { id: u.id, name: u.name }
    },
    list: async () => {
      const rows = await Post.query()
        .where('view_count', '>', fx.listThreshold)
        .orderBy('id')
        .limit(fx.listLimit)
        .get()
      return rows.map((r) => r.id)
    },
    largeGet: async () => {
      const rows = await Post.query().orderBy('id').limit(fx.largeLimit).get()
      return { count: rows.length, firstId: rows[0]?.id }
    },
    eagerPosts: async () => {
      const users = await User.query().whereIn('id', fx.eagerUserIds).with('posts').get()
      let posts = 0
      for (const u of users) posts += (u.posts ?? []).length
      return posts
    },
    m2mEager: async () => {
      const posts = await Post.query().whereIn('id', fx.eagerPostIds).with('tags').get()
      let tags = 0
      for (const p of posts) tags += (p.tags ?? []).length
      return tags
    },
    aggregate: async () => {
      const userCount = await User.query().count()
      const u = await User.query().where('id', fx.aggUserId).withCount('posts').first()
      return { userCount, postsCount: u?.postsCount ?? 0 }
    },
    increment: async () => {
      const p = await Post.find(fx.incrementPostId)
      await p.increment('view_count', 1)
      return p.view_count
    },
    toJSON: async () => {
      if (!toJsonRows) toJsonRows = await Post.query().orderBy('id').limit(fx.toJsonLimit).get()
      const json = JSON.stringify(toJsonRows)
      return { rows: toJsonRows.length, bytes: json.length > 0 }
    },
  }
}

export const writeOps = new Set(['insertSingle', 'insertBulk', 'increment'])
