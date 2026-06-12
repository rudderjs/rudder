// ─── Benchmark runner ────────────────────────────────────────────────────────
// Drives every (op × contender) directly against the same SQLite file via
// mitata's `measure()` (ns resolution, internal warmup + GC control). Writes a
// results JSON per size with a full provenance block. NO HTTP, NO server — pure
// query-layer cost.
//
//   pnpm bench            # default sizes (1k, 10k)
//   pnpm bench 1k         # one size
//   pnpm bench 1k 10k 100k
//
// Honors the fairness rules in README.md. Run `pnpm bench:setup` first.

import { measure } from 'mitata'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { CONTENDERS, OPS } from './contenders/index.mjs'
import { fixtures } from './fixtures.mjs'
import { dbPath } from './setup.mjs'
import { scratchCopy, cleanScratch } from './scratch.mjs'
import { checkParity } from './parity.mjs'
import { SIZES, SEED } from './schema.mjs'
import { ENGINE, IS_PG, IS_MYSQL, IS_SERVER, serverSizeDb } from './engine.mjs'
import * as pg from './pg.mjs'
import * as mysql from './mysql.mjs'

// The active server engine's admin module (dbExists/serverVersion); unused on SQLite.
const srv = IS_PG ? pg : mysql

const HERE = dirname(fileURLToPath(import.meta.url))
export const RESULTS_DIR = join(HERE, '..', 'results')

// Read an installed dependency's version straight from its package.json (some
// packages don't export ./package.json, so we read the file, not require it).
function depVersion(pkg) {
  try {
    const p = join(HERE, '..', 'node_modules', pkg, 'package.json')
    return JSON.parse(readFileSync(p, 'utf8')).version
  } catch {
    return 'unknown'
  }
}

async function provenance(size) {
  const cpu = os.cpus()
  // Driver/version block differs per engine — SQLite shares better-sqlite3
  // across all three; Postgres shares porsager (rudder + drizzle) with Prisma on
  // node-pg; MySQL shares mysql2 (rudder + drizzle) with Prisma on mariadb — plus
  // the live server version on both server engines.
  const versions = {
    '@rudderjs/orm': depVersion('@rudderjs/orm'),
    '@rudderjs/database': depVersion('@rudderjs/database'),
    'drizzle-orm': depVersion('drizzle-orm'),
    '@prisma/client': depVersion('@prisma/client'),
    ...(IS_PG
      ? { postgres: depVersion('postgres'), pg: depVersion('pg'), 'postgres-server': await srv.serverVersion() }
      : IS_MYSQL
        ? { mysql2: depVersion('mysql2'), mariadb: depVersion('mariadb'), 'mysql-server': await srv.serverVersion() }
        : { 'better-sqlite3': depVersion('better-sqlite3') }),
    mitata: depVersion('mitata'),
  }
  return {
    // Date is overridable so published runs are reproducible/pinned (plan §
    // runtime constraint) — set BENCH_DATE=2026-06-11 for a fixed stamp.
    date: process.env['BENCH_DATE'] ?? new Date().toISOString(),
    engine: ENGINE,
    size,
    users: SIZES[size],
    seed: SEED,
    node: process.version,
    os: `${os.type()} ${os.release()}`,
    arch: process.arch,
    cpu: cpu[0]?.model ?? 'unknown',
    cores: cpu.length,
    versions,
  }
}

// mitata measure() tuning — enough samples for stable p50/p99 without dragging
// the heavy ops (large hydration at 100k) into minutes.
const MEASURE_OPTS = { min_cpu_time: 500_000_000 }

async function benchOp(op, contender, size, fx) {
  const file = op.write ? await scratchCopy(size, `${contender.name}-${op.id}`) : dbPath(size)
  const ctx = await contender.connect(file)
  try {
    const run = contender.build(ctx, fx)[op.id]
    await run() // one warm call before measuring
    const s = await measure(run, MEASURE_OPTS)
    return {
      contender: contender.name,
      avg_ns: s.avg,
      p50_ns: s.p50,
      p99_ns: s.p99,
      min_ns: s.min,
      samples: s.samples?.length ?? 0,
      opsPerSec: s.avg > 0 ? 1e9 / s.avg : 0,
    }
  } finally {
    await contender.disconnect(ctx)
  }
}

async function runSize(size) {
  const ready = IS_SERVER ? await srv.dbExists(serverSizeDb(size)) : existsSync(dbPath(size))
  if (!ready) {
    const cmd = IS_PG
      ? `pnpm bench:pg:setup ${size}`
      : IS_MYSQL
        ? `pnpm bench:mysql:setup ${size}`
        : `pnpm bench:setup ${size}`
    throw new Error(`Seed DB missing for ${size}. Run: ${cmd}`)
  }
  const fx = fixtures(size)
  console.log(`\n━━ size ${size} (${SIZES[size]} users) ━━`)
  console.log('[parity] gating before timing…')
  await checkParity(size, { quiet: true })
  console.log('[parity] ✓ all ops agree\n')

  const ops = []
  for (const op of OPS) {
    const results = []
    for (const contender of CONTENDERS) {
      results.push(await benchOp(op, contender, size, fx))
    }
    // fastest (lowest avg) → relative speedup baseline for the console line
    const fastest = Math.min(...results.map((r) => r.avg_ns))
    const line = results
      .map((r) => `${r.contender}=${(r.avg_ns / 1000).toFixed(2)}µs${r.avg_ns === fastest ? '*' : ''}`)
      .join('  ')
    console.log(`${op.id.padEnd(13)} ${line}`)
    ops.push({ id: op.id, label: op.label, write: op.write, results })
  }
  await cleanScratch()

  mkdirSync(RESULTS_DIR, { recursive: true })
  const out = join(RESULTS_DIR, `${ENGINE}-${size}.json`)
  writeFileSync(out, JSON.stringify({ provenance: await provenance(size), ops }, null, 2))
  console.log(`\n[run] wrote ${out.split('/').slice(-2).join('/')}`)
}

const requested = process.argv.slice(2).filter((a) => a in SIZES)
const sizes = requested.length ? requested : ['1k', '10k']

for (const size of sizes) await runSize(size)
console.log('\n[run] done — render the table with `pnpm bench:report`')
