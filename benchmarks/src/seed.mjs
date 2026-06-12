// Deterministic seeder — writes a fully-populated SQLite file via raw
// better-sqlite3 (ORM-neutral, so no contender gets a seeding-path advantage).
// Same seed + same size ⇒ byte-identical data on every machine.

import Database from 'better-sqlite3'
import postgres from 'postgres'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { DDL, PG_DDL, MYSQL_DDL, FANOUT, SEED } from './schema.mjs'
import { mulberry32, randInt, words } from './prng.mjs'

// Fixed base epoch so created_at strings are deterministic (no Date.now()).
const BASE_EPOCH = Date.parse('2020-01-01T00:00:00.000Z')
const isoAt = (i) => new Date(BASE_EPOCH + i * 60_000).toISOString()

/**
 * Build a seeded database file at `file` with `userCount` users and the
 * proportional fan-out from schema.mjs. Overwrites any existing file.
 * @param {string} file
 * @param {number} userCount
 */
export function buildSeedDb(file, userCount) {
  mkdirSync(dirname(file), { recursive: true })
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) rmSync(f)

  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = OFF')
  for (const stmt of DDL) db.exec(stmt)

  const rng = mulberry32(SEED ^ userCount) // vary by size so they aren't prefixes

  const insertUser = db.prepare('INSERT INTO users (name, email, created_at) VALUES (?, ?, ?)')
  const insertPost = db.prepare(
    'INSERT INTO posts (user_id, title, body, view_count, published, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const insertComment = db.prepare(
    'INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
  )
  const insertTag = db.prepare('INSERT INTO tags (name) VALUES (?)')
  const insertPostTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)')

  const seedAll = db.transaction(() => {
    // Tags (fixed pool)
    for (let t = 1; t <= FANOUT.tagCount; t++) insertTag.run(`tag-${t}`)

    let postId = 0
    let counter = 0
    for (let u = 1; u <= userCount; u++) {
      insertUser.run(`User ${u}`, `user${u}@bench.test`, isoAt(counter++))
      for (let p = 0; p < FANOUT.postsPerUser; p++) {
        postId++
        insertPost.run(
          u,
          words(rng, 6),
          words(rng, 30),
          randInt(rng, 0, 5000),
          rng() < 0.7 ? 1 : 0,
          isoAt(counter++),
        )
        for (let c = 0; c < FANOUT.commentsPerPost; c++) {
          insertComment.run(postId, randInt(rng, 1, userCount), words(rng, 12), isoAt(counter++))
        }
        // tagsPerPost distinct tags
        for (let k = 0; k < FANOUT.tagsPerPost; k++) {
          insertPostTag.run(postId, randInt(rng, 1, FANOUT.tagCount))
        }
      }
    }
  })
  seedAll()

  // Flush the WAL into the main db file and truncate the sidecar, so a plain
  // copyFileSync of the .sqlite file (write-bench scratch copies) carries ALL
  // rows — otherwise recent writes stranded in -wal would be lost.
  db.pragma('wal_checkpoint(TRUNCATE)')

  const counts = {
    users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    posts: db.prepare('SELECT COUNT(*) n FROM posts').get().n,
    comments: db.prepare('SELECT COUNT(*) n FROM comments').get().n,
    tags: db.prepare('SELECT COUNT(*) n FROM tags').get().n,
    post_tags: db.prepare('SELECT COUNT(*) n FROM post_tags').get().n,
  }
  db.close()
  return counts
}

/**
 * Seed an EMPTY Postgres database at `url` (created by pg.mjs#createFreshDb) with
 * the same dataset shape as the SQLite seeder — same PRNG, same fan-out, same
 * row count, so the two engines' datasets are equivalent. Rows are bulk-inserted
 * via porsager (ORM-neutral, like raw better-sqlite3) so no contender gets a
 * seeding-path edge. SERIAL assigns ids in insertion order (1..N), matching the
 * SQLite AUTOINCREMENT ids the fixtures assume.
 * @param {string} url   connection URL for the (already-created) database
 * @param {number} userCount
 */
export async function buildSeedPg(url, userCount) {
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    for (const stmt of PG_DDL) await sql.unsafe(stmt)

    const rng = mulberry32(SEED ^ userCount) // same stream as the SQLite seeder

    const tags = []
    for (let t = 1; t <= FANOUT.tagCount; t++) tags.push({ name: `tag-${t}` })

    const users = []
    const posts = []
    const comments = []
    const postTags = new Set() // dedup (post_id,tag_id) like SQLite's INSERT OR IGNORE

    let postId = 0
    let counter = 0
    for (let u = 1; u <= userCount; u++) {
      users.push({ name: `User ${u}`, email: `user${u}@bench.test`, created_at: isoAt(counter++) })
      for (let p = 0; p < FANOUT.postsPerUser; p++) {
        postId++
        // PRNG call order mirrors the SQLite seeder exactly (title, body,
        // view_count, published, then per-comment user+body, then tags).
        const title = words(rng, 6)
        const body = words(rng, 30)
        const view_count = randInt(rng, 0, 5000)
        const published = rng() < 0.7
        posts.push({ user_id: u, title, body, view_count, published, created_at: isoAt(counter++) })
        for (let c = 0; c < FANOUT.commentsPerPost; c++) {
          const cu = randInt(rng, 1, userCount)
          comments.push({ post_id: postId, user_id: cu, body: words(rng, 12), created_at: isoAt(counter++) })
        }
        for (let k = 0; k < FANOUT.tagsPerPost; k++) {
          postTags.add(`${postId},${randInt(rng, 1, FANOUT.tagCount)}`)
        }
      }
    }

    const chunk = async (rows, insert) => {
      for (let i = 0; i < rows.length; i += 5000) await insert(rows.slice(i, i + 5000))
    }
    await sql`INSERT INTO tags ${sql(tags, 'name')}`
    await chunk(users, (c) => sql`INSERT INTO users ${sql(c, 'name', 'email', 'created_at')}`)
    await chunk(posts, (c) =>
      sql`INSERT INTO posts ${sql(c, 'user_id', 'title', 'body', 'view_count', 'published', 'created_at')}`,
    )
    await chunk(comments, (c) =>
      sql`INSERT INTO comments ${sql(c, 'post_id', 'user_id', 'body', 'created_at')}`,
    )
    const ptRows = [...postTags].map((s) => {
      const [post_id, tag_id] = s.split(',').map(Number)
      return { post_id, tag_id }
    })
    await chunk(ptRows, (c) => sql`INSERT INTO post_tags ${sql(c, 'post_id', 'tag_id')}`)

    const count = async (t) => Number((await sql.unsafe(`SELECT COUNT(*) n FROM ${t}`))[0].n)
    return {
      users: await count('users'),
      posts: await count('posts'),
      comments: await count('comments'),
      tags: await count('tags'),
      post_tags: await count('post_tags'),
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/**
 * Seed an EMPTY MySQL database at `url` (created by mysql.mjs#createFreshDb) with
 * the same dataset shape as the SQLite/Postgres seeders — same PRNG, same fan-out,
 * same row counts — so all three engines' datasets are equivalent. Rows are
 * bulk-inserted via raw mysql2 (`INSERT … VALUES ?` with a nested array, the
 * driver's native multi-row form), ORM-neutral like better-sqlite3 / porsager, so
 * no contender gets a seeding-path edge. AUTO_INCREMENT assigns ids in insertion
 * order (1..N), matching the ids the fixtures assume.
 * @param {string} url   connection URL for the (already-created) database
 * @param {number} userCount
 */
export async function buildSeedMysql(url, userCount) {
  const mysql = await import('mysql2/promise')
  const conn = await mysql.createConnection({ uri: url })
  try {
    for (const stmt of MYSQL_DDL) await conn.query(stmt)

    const rng = mulberry32(SEED ^ userCount) // same stream as the SQLite/PG seeders

    // Rows are built as positional arrays (mysql2's bulk form takes [[...], ...]).
    const tags = []
    for (let t = 1; t <= FANOUT.tagCount; t++) tags.push([`tag-${t}`])

    const users = []
    const posts = []
    const comments = []
    const postTags = new Set() // dedup (post_id,tag_id) like SQLite's INSERT OR IGNORE

    let postId = 0
    let counter = 0
    for (let u = 1; u <= userCount; u++) {
      users.push([`User ${u}`, `user${u}@bench.test`, isoAt(counter++)])
      for (let p = 0; p < FANOUT.postsPerUser; p++) {
        postId++
        // PRNG call order mirrors the SQLite/PG seeders exactly (title, body,
        // view_count, published, then per-comment user+body, then tags).
        const title = words(rng, 6)
        const body = words(rng, 30)
        const view_count = randInt(rng, 0, 5000)
        const published = rng() < 0.7 ? 1 : 0 // TINYINT(1); read back as boolean
        posts.push([u, title, body, view_count, published, isoAt(counter++)])
        for (let c = 0; c < FANOUT.commentsPerPost; c++) {
          const cu = randInt(rng, 1, userCount)
          comments.push([postId, cu, words(rng, 12), isoAt(counter++)])
        }
        for (let k = 0; k < FANOUT.tagsPerPost; k++) {
          postTags.add(`${postId},${randInt(rng, 1, FANOUT.tagCount)}`)
        }
      }
    }

    const chunk = async (rows, text) => {
      for (let i = 0; i < rows.length; i += 5000) await conn.query(text, [rows.slice(i, i + 5000)])
    }
    await conn.beginTransaction()
    await conn.query('INSERT INTO tags (name) VALUES ?', [tags])
    await chunk(users, 'INSERT INTO users (name, email, created_at) VALUES ?')
    await chunk(posts, 'INSERT INTO posts (user_id, title, body, view_count, published, created_at) VALUES ?')
    await chunk(comments, 'INSERT INTO comments (post_id, user_id, body, created_at) VALUES ?')
    const ptRows = [...postTags].map((s) => s.split(',').map(Number))
    await chunk(ptRows, 'INSERT INTO post_tags (post_id, tag_id) VALUES ?')
    await conn.commit()

    const count = async (t) => Number((await conn.query(`SELECT COUNT(*) n FROM ${t}`))[0][0].n)
    return {
      users: await count('users'),
      posts: await count('posts'),
      comments: await count('comments'),
      tags: await count('tags'),
      post_tags: await count('post_tags'),
    }
  } finally {
    await conn.end()
  }
}
