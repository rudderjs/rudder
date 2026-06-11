// Deterministic seeder — writes a fully-populated SQLite file via raw
// better-sqlite3 (ORM-neutral, so no contender gets a seeding-path advantage).
// Same seed + same size ⇒ byte-identical data on every machine.

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { DDL, FANOUT, SEED } from './schema.mjs'
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
