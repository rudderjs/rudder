// ─── Contender: Drizzle ORM ──────────────────────────────────────────────────
// drizzle-orm over the same database the others use. Drizzle maps onto the
// existing tables (it never creates them). Relational queries (`db.query.*`)
// require the `relations()` declarations below; the rest use the core query
// builder.
//
// Unlike rudder/prisma, Drizzle's API genuinely differs by engine — the
// better-sqlite3 driver is synchronous (`.run()`/`.get()`/`.all()`) while the
// postgres-js driver is async (`await query`). So this contender keeps a
// separate, idiomatic build() per engine rather than hiding the difference
// behind a shim — a benchmark should run each ORM's real documented path.
//
// On Postgres, Drizzle uses postgres-js (porsager), the SAME underlying driver
// as the rudder native engine — so rudder vs drizzle is a pure query-layer
// comparison over one driver. (Prisma is on node-pg; see prisma.mjs.)

import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js'
import { sqliteTable, integer, text, primaryKey } from 'drizzle-orm/sqlite-core'
import {
  pgTable,
  serial,
  integer as pgInteger,
  text as pgText,
  boolean as pgBoolean,
  primaryKey as pgPrimaryKey,
} from 'drizzle-orm/pg-core'
import { relations, eq, gt, inArray, count, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { PRAGMAS } from '../schema.mjs'
import { IS_PG } from '../engine.mjs'

export const name = 'drizzle'

// ── Table definitions, one set per engine (only the active engine's set is used)
function sqliteSchema() {
  const users = sqliteTable('users', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    createdAt: text('created_at').notNull(),
  })
  const posts = sqliteTable('posts', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    viewCount: integer('view_count').notNull().default(0),
    published: integer('published').notNull().default(0),
    createdAt: text('created_at').notNull(),
  })
  const comments = sqliteTable('comments', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    postId: integer('post_id').notNull(),
    userId: integer('user_id').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
  })
  const tags = sqliteTable('tags', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
  })
  const postTags = sqliteTable(
    'post_tags',
    { postId: integer('post_id').notNull(), tagId: integer('tag_id').notNull() },
    (t) => ({ pk: primaryKey({ columns: [t.postId, t.tagId] }) }),
  )
  return { users, posts, comments, tags, postTags }
}

function pgSchema() {
  const users = pgTable('users', {
    id: serial('id').primaryKey(),
    name: pgText('name').notNull(),
    email: pgText('email').notNull(),
    createdAt: pgText('created_at').notNull(),
  })
  const posts = pgTable('posts', {
    id: serial('id').primaryKey(),
    userId: pgInteger('user_id').notNull(),
    title: pgText('title').notNull(),
    body: pgText('body').notNull(),
    viewCount: pgInteger('view_count').notNull().default(0),
    published: pgBoolean('published').notNull().default(false),
    createdAt: pgText('created_at').notNull(),
  })
  const comments = pgTable('comments', {
    id: serial('id').primaryKey(),
    postId: pgInteger('post_id').notNull(),
    userId: pgInteger('user_id').notNull(),
    body: pgText('body').notNull(),
    createdAt: pgText('created_at').notNull(),
  })
  const tags = pgTable('tags', {
    id: serial('id').primaryKey(),
    name: pgText('name').notNull(),
  })
  const postTags = pgTable(
    'post_tags',
    { postId: pgInteger('post_id').notNull(), tagId: pgInteger('tag_id').notNull() },
    (t) => ({ pk: pgPrimaryKey({ columns: [t.postId, t.tagId] }) }),
  )
  return { users, posts, comments, tags, postTags }
}

const { users, posts, comments, tags, postTags } = IS_PG ? pgSchema() : sqliteSchema()

const usersRelations = relations(users, ({ many }) => ({ posts: many(posts) }))
const postsRelations = relations(posts, ({ one, many }) => ({
  user: one(users, { fields: [posts.userId], references: [users.id] }),
  comments: many(comments),
  postTags: many(postTags),
}))
const commentsRelations = relations(comments, ({ one }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
  user: one(users, { fields: [comments.userId], references: [users.id] }),
}))
const tagsRelations = relations(tags, ({ many }) => ({ postTags: many(postTags) }))
const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(posts, { fields: [postTags.postId], references: [posts.id] }),
  tag: one(tags, { fields: [postTags.tagId], references: [tags.id] }),
}))

const schema = {
  users, posts, comments, tags, postTags,
  usersRelations, postsRelations, commentsRelations, tagsRelations, postTagsRelations,
}

// Map the ORM-neutral fixtures (snake_case created_at) to Drizzle's JS keys.
const toUserRow = (r) => ({ name: r.name, email: r.email, createdAt: r.created_at })

export async function connect(file) {
  if (IS_PG) {
    const client = postgres(file, { onnotice: () => {} })
    const db = drizzlePg(client, { schema })
    return { client, db }
  }
  const sqlite = new Database(file)
  for (const p of PRAGMAS) sqlite.exec(p)
  const db = drizzleSqlite(sqlite, { schema })
  return { sqlite, db }
}

export async function disconnect(ctx) {
  if (IS_PG) return ctx.client.end({ timeout: 5 })
  ctx.sqlite.close()
}

// ── SQLite build: synchronous better-sqlite3 API (.run/.get/.all)
function buildSqlite(ctx, fx) {
  const { db } = ctx
  let pk = 0
  let toJsonRows = null // hydrated once (during warm-up) so the timed run is pure serialization
  return {
    insertSingle: async () => {
      db.insert(users).values(toUserRow(fx.newUser)).run()
      return 1
    },
    insertBulk: async () => {
      db.insert(users).values(fx.bulkRows.map(toUserRow)).run()
      return fx.bulkRows.length
    },
    findByPk: async () => {
      const id = fx.pkWindow[pk++ % fx.pkWindow.length]
      const u = db.select().from(users).where(eq(users.id, id)).get()
      return { id: u.id, name: u.name }
    },
    list: async () => {
      const rows = db
        .select()
        .from(posts)
        .where(gt(posts.viewCount, fx.listThreshold))
        .orderBy(posts.id)
        .limit(fx.listLimit)
        .all()
      return rows.map((r) => r.id)
    },
    largeGet: async () => {
      const rows = db.select().from(posts).orderBy(posts.id).limit(fx.largeLimit).all()
      return { count: rows.length, firstId: rows[0]?.id }
    },
    eagerPosts: async () => {
      const rows = await db.query.users.findMany({
        where: inArray(users.id, fx.eagerUserIds),
        with: { posts: true },
      })
      let posts_ = 0
      for (const u of rows) posts_ += u.posts.length
      return posts_
    },
    m2mEager: async () => {
      const rows = await db.query.posts.findMany({
        where: inArray(posts.id, fx.eagerPostIds),
        with: { postTags: { with: { tag: true } } },
      })
      let tagsN = 0
      for (const p of rows) tagsN += p.postTags.length
      return tagsN
    },
    aggregate: async () => {
      const userCount = db.select({ c: count() }).from(users).get().c
      const postsCount = db
        .select({ c: count() })
        .from(posts)
        .where(eq(posts.userId, fx.aggUserId))
        .get().c
      return { userCount, postsCount }
    },
    increment: async () => {
      const r = db
        .update(posts)
        .set({ viewCount: sql`${posts.viewCount} + 1` })
        .where(eq(posts.id, fx.incrementPostId))
        .returning({ v: posts.viewCount })
        .get()
      return r.v
    },
    toJSON: async () => {
      if (!toJsonRows) toJsonRows = db.select().from(posts).orderBy(posts.id).limit(fx.toJsonLimit).all()
      const json = JSON.stringify(toJsonRows)
      return { rows: toJsonRows.length, bytes: json.length > 0 }
    },
  }
}

// ── Postgres build: async postgres-js API (await query; [0] for one row).
// count() comes back as a bigint string on pg, so coerce to Number to match
// SQLite's numeric result for the parity gate.
function buildPg(ctx, fx) {
  const { db } = ctx
  let pk = 0
  let toJsonRows = null
  return {
    insertSingle: async () => {
      await db.insert(users).values(toUserRow(fx.newUser))
      return 1
    },
    insertBulk: async () => {
      await db.insert(users).values(fx.bulkRows.map(toUserRow))
      return fx.bulkRows.length
    },
    findByPk: async () => {
      const id = fx.pkWindow[pk++ % fx.pkWindow.length]
      const u = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0]
      return { id: u.id, name: u.name }
    },
    list: async () => {
      const rows = await db
        .select()
        .from(posts)
        .where(gt(posts.viewCount, fx.listThreshold))
        .orderBy(posts.id)
        .limit(fx.listLimit)
      return rows.map((r) => r.id)
    },
    largeGet: async () => {
      const rows = await db.select().from(posts).orderBy(posts.id).limit(fx.largeLimit)
      return { count: rows.length, firstId: rows[0]?.id }
    },
    eagerPosts: async () => {
      const rows = await db.query.users.findMany({
        where: inArray(users.id, fx.eagerUserIds),
        with: { posts: true },
      })
      let posts_ = 0
      for (const u of rows) posts_ += u.posts.length
      return posts_
    },
    m2mEager: async () => {
      const rows = await db.query.posts.findMany({
        where: inArray(posts.id, fx.eagerPostIds),
        with: { postTags: { with: { tag: true } } },
      })
      let tagsN = 0
      for (const p of rows) tagsN += p.postTags.length
      return tagsN
    },
    aggregate: async () => {
      const userCount = Number((await db.select({ c: count() }).from(users))[0].c)
      const postsCount = Number(
        (await db.select({ c: count() }).from(posts).where(eq(posts.userId, fx.aggUserId)))[0].c,
      )
      return { userCount, postsCount }
    },
    increment: async () => {
      const r = (
        await db
          .update(posts)
          .set({ viewCount: sql`${posts.viewCount} + 1` })
          .where(eq(posts.id, fx.incrementPostId))
          .returning({ v: posts.viewCount })
      )[0]
      return r.v
    },
    toJSON: async () => {
      if (!toJsonRows) toJsonRows = await db.select().from(posts).orderBy(posts.id).limit(fx.toJsonLimit)
      const json = JSON.stringify(toJsonRows)
      return { rows: toJsonRows.length, bytes: json.length > 0 }
    },
  }
}

export const build = IS_PG ? buildPg : buildSqlite

export const writeOps = new Set(['insertSingle', 'insertBulk', 'increment'])
