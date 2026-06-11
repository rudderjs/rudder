// ─── Single source of truth: schema DDL + dataset spec ───────────────────────
//
// The fairest possible comparison applies BYTE-IDENTICAL DDL to all three ORMs:
// one raw-SQL schema, created via better-sqlite3, then each ORM merely *maps*
// onto the existing tables (Prisma @@map/@map, Drizzle sqliteTable, RudderJS
// `static table`). No ORM owns the DDL, so no ORM gets a schema-shape advantage.
//
// `created_at` is TEXT (ISO string) rather than a datetime type on purpose:
// each ORM serializes datetimes differently on SQLite, which would make the
// stored bytes — and therefore the work each ORM does — diverge. A plain string
// column is identical everywhere.

export const DDL = [
  `CREATE TABLE users (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     name       TEXT NOT NULL,
     email      TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE posts (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id    INTEGER NOT NULL,
     title      TEXT NOT NULL,
     body       TEXT NOT NULL,
     view_count INTEGER NOT NULL DEFAULT 0,
     published  INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX idx_posts_user_id ON posts(user_id)`,
  `CREATE TABLE comments (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     post_id    INTEGER NOT NULL,
     user_id    INTEGER NOT NULL,
     body       TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX idx_comments_post_id ON comments(post_id)`,
  `CREATE INDEX idx_comments_user_id ON comments(user_id)`,
  `CREATE TABLE tags (
     id   INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL
   )`,
  `CREATE TABLE post_tags (
     post_id INTEGER NOT NULL,
     tag_id  INTEGER NOT NULL,
     PRIMARY KEY (post_id, tag_id)
   )`,
  `CREATE INDEX idx_post_tags_tag_id ON post_tags(tag_id)`,
]

// Postgres DDL — the same shape mapped onto Postgres types: SERIAL for the
// AUTOINCREMENT primary keys, real BOOLEAN for `published` (SQLite has no bool,
// so it stores INTEGER 0/1; no op's result value exposes `published`, so this
// divergence stays invisible to the parity gate). `created_at` is TEXT on both
// engines so the stored bytes — and the hydration work — match exactly.
export const PG_DDL = [
  `CREATE TABLE users (
     id         SERIAL PRIMARY KEY,
     name       TEXT NOT NULL,
     email      TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE posts (
     id         SERIAL PRIMARY KEY,
     user_id    INTEGER NOT NULL,
     title      TEXT NOT NULL,
     body       TEXT NOT NULL,
     view_count INTEGER NOT NULL DEFAULT 0,
     published  BOOLEAN NOT NULL DEFAULT false,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX idx_posts_user_id ON posts(user_id)`,
  `CREATE TABLE comments (
     id         SERIAL PRIMARY KEY,
     post_id    INTEGER NOT NULL,
     user_id    INTEGER NOT NULL,
     body       TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX idx_comments_post_id ON comments(post_id)`,
  `CREATE INDEX idx_comments_user_id ON comments(user_id)`,
  `CREATE TABLE tags (
     id   SERIAL PRIMARY KEY,
     name TEXT NOT NULL
   )`,
  `CREATE TABLE post_tags (
     post_id INTEGER NOT NULL,
     tag_id  INTEGER NOT NULL,
     PRIMARY KEY (post_id, tag_id)
   )`,
  `CREATE INDEX idx_post_tags_tag_id ON post_tags(tag_id)`,
]

// Connection pragmas applied IDENTICALLY by every contender's setup. WAL +
// NORMAL is the standard production SQLite profile; pinning them removes
// journal/sync mode as a hidden variable between ORMs.
export const PRAGMAS = [
  `PRAGMA journal_mode = WAL`,
  `PRAGMA synchronous = NORMAL`,
  `PRAGMA foreign_keys = OFF`,
]

// Dataset sizes (number of users) and the proportional fan-out. Fixed seed →
// deterministic rows. Kept modest per-parent so 100k users stays a few-second
// seed, not minutes.
export const SIZES = {
  '1k': 1_000,
  '10k': 10_000,
  '100k': 100_000,
}

export const FANOUT = {
  postsPerUser: 5,
  commentsPerPost: 2,
  tagCount: 20,
  tagsPerPost: 3,
}

export const SEED = 0x9e3779b9 // golden-ratio constant; any fixed value works
