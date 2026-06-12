// Fresh per-run copies of a seeded DB for write benches, so each contender's
// write op starts from identical state and runs never contaminate each other or
// the canonical seed. SQLite copies the .sqlite file; Postgres CREATE DATABASE …
// TEMPLATE-clones the per-size seed database (a fast file-level copy); MySQL
// recreates the tables and bulk-copies rows (no TEMPLATE/file to copy — see
// mysql.mjs#cloneDb). Every helper is async so the server admin round-trips can
// be awaited uniformly.

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbPath } from './setup.mjs'
import { IS_PG, IS_SERVER, serverSizeDb, serverBaseUrl } from './engine.mjs'
import * as pg from './pg.mjs'
import * as mysql from './mysql.mjs'

// The active server engine's admin module (cloneDb/dropDb); both share the API.
const srv = IS_PG ? pg : mysql

const HERE = dirname(fileURLToPath(import.meta.url))
export const SCRATCH_DIR = join(HERE, '..', '.scratch')

// Server scratch databases created this run, so cleanScratch can drop them.
const serverScratch = new Set()

// Map a free-form tag (`rudder-insertSingle`) to a valid, unique database id.
const scratchDbName = (size, tag) =>
  `scratch_${tag.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${size}`.slice(0, 63)

/** Copy the seed DB for `size` to a fresh scratch, tagged `tag`; return its
 *  connect target (file path on SQLite, connection URL on Postgres/MySQL). */
export async function scratchCopy(size, tag) {
  if (IS_SERVER) {
    const name = scratchDbName(size, tag)
    await srv.cloneDb(serverSizeDb(size), name)
    serverScratch.add(name)
    return `${serverBaseUrl()}/${name}`
  }
  mkdirSync(SCRATCH_DIR, { recursive: true })
  const dst = join(SCRATCH_DIR, `${tag}-${size}.sqlite`)
  for (const f of [dst, `${dst}-wal`, `${dst}-shm`]) if (existsSync(f)) rmSync(f)
  copyFileSync(dbPath(size), dst)
  return dst
}

/** Remove all scratch databases/files created this run. */
export async function cleanScratch() {
  if (IS_SERVER) {
    for (const name of serverScratch) await srv.dropDb(name)
    serverScratch.clear()
    return
  }
  if (existsSync(SCRATCH_DIR)) rmSync(SCRATCH_DIR, { recursive: true, force: true })
}
