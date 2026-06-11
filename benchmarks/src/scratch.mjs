// Fresh per-run copies of a seeded DB for write benches, so each contender's
// write op starts from identical state and runs never contaminate each other or
// the canonical seed. SQLite copies the .sqlite file; Postgres CREATE DATABASE …
// TEMPLATE-clones the per-size seed database (a fast file-level copy). Both
// helpers are async so the Postgres admin round-trips can be awaited uniformly.

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbPath } from './setup.mjs'
import { IS_PG, pgSizeDb, pgBaseUrl } from './engine.mjs'
import { cloneDb, dropDb } from './pg.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SCRATCH_DIR = join(HERE, '..', '.scratch')

// Postgres scratch databases created this run, so cleanScratch can drop them.
const pgScratch = new Set()

// Map a free-form tag (`rudder-insertSingle`) to a valid, unique pg database id.
const scratchDbName = (size, tag) =>
  `scratch_${tag.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${size}`.slice(0, 63)

/** Copy the seed DB for `size` to a fresh scratch, tagged `tag`; return its
 *  connect target (file path on SQLite, connection URL on Postgres). */
export async function scratchCopy(size, tag) {
  if (IS_PG) {
    const name = scratchDbName(size, tag)
    await cloneDb(pgSizeDb(size), name)
    pgScratch.add(name)
    return `${pgBaseUrl()}/${name}`
  }
  mkdirSync(SCRATCH_DIR, { recursive: true })
  const dst = join(SCRATCH_DIR, `${tag}-${size}.sqlite`)
  for (const f of [dst, `${dst}-wal`, `${dst}-shm`]) if (existsSync(f)) rmSync(f)
  copyFileSync(dbPath(size), dst)
  return dst
}

/** Remove all scratch databases/files created this run. */
export async function cleanScratch() {
  if (IS_PG) {
    for (const name of pgScratch) await dropDb(name)
    pgScratch.clear()
    return
  }
  if (existsSync(SCRATCH_DIR)) rmSync(SCRATCH_DIR, { recursive: true, force: true })
}
