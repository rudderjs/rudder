// bench:setup — (re)builds the seeded SQLite databases the read benches run
// against. Write benches copy a fresh scratch from these. Idempotent: safe to
// re-run; rebuilds every size from scratch with the fixed seed.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildSeedDb } from './seed.mjs'
import { SIZES } from './schema.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DBS_DIR = join(HERE, '..', '.dbs')
export const dbPath = (size) => join(DBS_DIR, `seed-${size}.sqlite`)

// Which sizes to build — default all; override with e.g. `node src/setup.mjs 1k 10k`.
const requested = process.argv.slice(2).filter((a) => a in SIZES)
const sizes = requested.length ? requested : Object.keys(SIZES)

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const size of sizes) {
    const t0 = performance.now()
    const counts = buildSeedDb(dbPath(size), SIZES[size])
    const ms = Math.round(performance.now() - t0)
    console.log(
      `[seed] ${size.padEnd(4)} → ${dbPath(size).split('/').slice(-2).join('/')}  ` +
        `(${counts.users} users, ${counts.posts} posts, ${counts.comments} comments, ` +
        `${counts.post_tags} post_tags)  ${ms}ms`,
    )
  }
  console.log('[seed] done')
}
