// bench:setup — (re)builds the seeded databases the read benches run against.
// Write benches copy a fresh scratch from these. Idempotent: safe to re-run;
// rebuilds every size from scratch with the fixed seed.
//
//   node src/setup.mjs                 # SQLite (default), all sizes
//   BENCH_ENGINE=postgres node src/setup.mjs 1k 10k   # Postgres, named sizes
//
// SQLite target = a .sqlite file; Postgres target = a per-size database
// (rudder_bench_<size>). `dbPath(size)` returns whichever the active engine
// uses, so every downstream module (run/parity/scratch) treats it as an opaque
// "connect here" string.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildSeedDb, buildSeedPg } from './seed.mjs'
import { SIZES } from './schema.mjs'
import { IS_PG, pgSizeDb, pgSizeUrl } from './engine.mjs'
import { createFreshDb } from './pg.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DBS_DIR = join(HERE, '..', '.dbs')

/** The connect target for a size: a .sqlite file (SQLite) or a connection URL
 *  (Postgres). Opaque to the contenders — they just hand it to their driver. */
export const dbPath = (size) =>
  IS_PG ? pgSizeUrl(size) : join(DBS_DIR, `seed-${size}.sqlite`)

/** Build + seed one size, returning the row counts. */
export async function buildSize(size) {
  if (IS_PG) {
    await createFreshDb(pgSizeDb(size))
    return buildSeedPg(pgSizeUrl(size), SIZES[size])
  }
  return buildSeedDb(dbPath(size), SIZES[size])
}

// Which sizes to build — default all; override with e.g. `node src/setup.mjs 1k 10k`.
const requested = process.argv.slice(2).filter((a) => a in SIZES)
const sizes = requested.length ? requested : Object.keys(SIZES)

if (import.meta.url === `file://${process.argv[1]}`) {
  const where = IS_PG ? 'postgres' : 'sqlite'
  for (const size of sizes) {
    const t0 = performance.now()
    const c = await buildSize(size)
    const ms = Math.round(performance.now() - t0)
    const target = IS_PG ? pgSizeDb(size) : dbPath(size).split('/').slice(-2).join('/')
    console.log(
      `[seed:${where}] ${size.padEnd(4)} → ${target}  ` +
        `(${c.users} users, ${c.posts} posts, ${c.comments} comments, ${c.post_tags} post_tags)  ${ms}ms`,
    )
  }
  console.log('[seed] done')
}
