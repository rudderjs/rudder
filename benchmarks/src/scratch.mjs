// Fresh per-run copies of a seeded DB for write benches, so each contender's
// write op starts from identical state and runs never contaminate each other or
// the canonical seed file.

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dbPath } from './setup.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SCRATCH_DIR = join(HERE, '..', '.scratch')

/** Copy the seed DB for `size` to a fresh scratch file tagged `tag`. */
export function scratchCopy(size, tag) {
  mkdirSync(SCRATCH_DIR, { recursive: true })
  const dst = join(SCRATCH_DIR, `${tag}-${size}.sqlite`)
  for (const f of [dst, `${dst}-wal`, `${dst}-shm`]) if (existsSync(f)) rmSync(f)
  copyFileSync(dbPath(size), dst)
  return dst
}

/** Remove all scratch files. */
export function cleanScratch() {
  if (existsSync(SCRATCH_DIR)) rmSync(SCRATCH_DIR, { recursive: true, force: true })
}
