// bench:setup — (re)builds the seeded databases the read benches run against.
// Write benches copy a fresh scratch from these. Idempotent: safe to re-run;
// rebuilds every size from scratch with the fixed seed.
//
//   node src/setup.mjs                 # SQLite (default), all sizes
//   BENCH_ENGINE=postgres node src/setup.mjs 1k 10k   # Postgres, named sizes
//   BENCH_ENGINE=mysql    node src/setup.mjs 1k 10k   # MySQL, named sizes
//
// SQLite target = a .sqlite file; Postgres/MySQL target = a per-size database
// (rudder_bench_<size>). `dbPath(size)` returns whichever the active engine
// uses, so every downstream module (run/parity/scratch) treats it as an opaque
// "connect here" string.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildSeedDb, buildSeedPg, buildSeedMysql } from './seed.mjs'
import { SIZES } from './schema.mjs'
import { ENGINE, IS_PG, IS_MYSQL, IS_SERVER, serverSizeDb, serverSizeUrl } from './engine.mjs'
import * as pg from './pg.mjs'
import * as mysql from './mysql.mjs'

// The active server engine's admin module (createFreshDb/cloneDb/dropDb/…); both
// expose the same API. Unused on SQLite.
const srv = IS_PG ? pg : mysql

const HERE = dirname(fileURLToPath(import.meta.url))
export const DBS_DIR = join(HERE, '..', '.dbs')

/** The connect target for a size: a .sqlite file (SQLite) or a connection URL
 *  (Postgres/MySQL). Opaque to the contenders — they just hand it to their driver. */
export const dbPath = (size) =>
  IS_SERVER ? serverSizeUrl(size) : join(DBS_DIR, `seed-${size}.sqlite`)

/** Build + seed one size, returning the row counts. */
export async function buildSize(size) {
  if (IS_SERVER) {
    await srv.createFreshDb(serverSizeDb(size))
    const seed = IS_MYSQL ? buildSeedMysql : buildSeedPg
    return seed(serverSizeUrl(size), SIZES[size])
  }
  return buildSeedDb(dbPath(size), SIZES[size])
}

// Which sizes to build — default all; override with e.g. `node src/setup.mjs 1k 10k`.
const requested = process.argv.slice(2).filter((a) => a in SIZES)
const sizes = requested.length ? requested : Object.keys(SIZES)

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const size of sizes) {
    const t0 = performance.now()
    const c = await buildSize(size)
    const ms = Math.round(performance.now() - t0)
    const target = IS_SERVER ? serverSizeDb(size) : dbPath(size).split('/').slice(-2).join('/')
    console.log(
      `[seed:${ENGINE}] ${size.padEnd(4)} → ${target}  ` +
        `(${c.users} users, ${c.posts} posts, ${c.comments} comments, ${c.post_tags} post_tags)  ${ms}ms`,
    )
  }
  console.log('[seed] done')
}
