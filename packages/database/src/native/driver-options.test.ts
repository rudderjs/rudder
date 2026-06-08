// Declarative driver options (NativeConfig.options) — threading + HMR signature.
//
// Two things to prove:
//  1. `config.options` actually reaches the underlying driver's open() — shown
//     behaviourally on sqlite: a `{ readonly: true }` connection rejects writes
//     (the option only takes effect if it was forwarded to the better-sqlite3
//     Database constructor). Replica drivers open with the same options.
//  2. The dev-HMR cache signature folds options in: the no-options form stays
//     byte-identical to before (regression-safety), present options append a
//     distinct segment, and two different options → two different signatures →
//     a config edit disposes + reopens rather than reusing a stale driver.

import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NativeAdapter } from './adapter.js'

let dir: string
let n = 0
before(() => { dir = mkdtempSync(join(tmpdir(), 'rudder-driver-opts-')) })
after(() => { rmSync(dir, { recursive: true, force: true }) })

/** Create a sqlite file with a `notes(id, src)` table + one row. */
async function seedFile(name: string): Promise<string> {
  const file = join(dir, name)
  const seeder = await NativeAdapter.make({ driver: 'sqlite', url: file })
  await seeder.affectingStatement('create table notes (id integer primary key autoincrement, src text)', [])
  await seeder.affectingStatement('insert into notes (src) values (?)', ['seed'])
  await seeder.disconnect()
  return file
}

/** The dev-HMR client cache (per-connection map on globalThis). */
function cache(): Map<string, { signature: string }> {
  return (globalThis as Record<string, unknown>)['__rudderjs_native_client__'] as Map<string, { signature: string }>
}

// ── options reach the driver ──

test('options forward to the driver: a readonly sqlite connection rejects writes', async () => {
  const file = await seedFile(`ro-${++n}.db`)

  // Baseline: no options → writes succeed.
  const writable = await NativeAdapter.make({ driver: 'sqlite', url: file, connectionName: `rw-${n}` })
  try {
    await writable.affectingStatement('insert into notes (src) values (?)', ['written'])
  } finally {
    await writable.disconnect()
  }

  // With { readonly: true } the option only bites if it reached better-sqlite3.
  const readonly = await NativeAdapter.make({
    driver: 'sqlite', url: file, connectionName: `ro-conn-${n}`, options: { readonly: true },
  })
  try {
    const rows = await readonly.query<{ src: string }>('notes').get()
    assert.ok(rows.length >= 1, 'reads still work on a readonly connection')
    await assert.rejects(
      () => readonly.affectingStatement('insert into notes (src) values (?)', ['nope']),
      /readonly/i,
      'a write on a readonly-option connection is rejected by the driver',
    )
  } finally {
    await readonly.disconnect()
  }
})

test('replica drivers open with the same options as the write connection', async () => {
  const writeFile = await seedFile(`opt-w-${++n}.db`)
  const readFile = await seedFile(`opt-r-${n}.db`)
  // readonly applies to BOTH the write and the replica driver. The un-locked
  // read routes to the replica; a write routes to the (also-readonly) writer.
  const adapter = await NativeAdapter.make({
    driver: 'sqlite', url: writeFile, readUrls: [readFile],
    connectionName: `opt-split-${n}`, options: { readonly: true },
  })
  try {
    const rows = await adapter.query<{ src: string }>('notes').get()
    assert.deepEqual(rows.map((r) => r.src), ['seed'], 'replica read works (replica opened readonly, reads allowed)')
    await assert.rejects(
      () => adapter.affectingStatement('insert into notes (src) values (?)', ['nope']),
      /readonly/i,
      'write rejected → the writer driver also received the readonly option',
    )
  } finally {
    await adapter.disconnect()
  }
})

// ── HMR cache signature ──

test('no-options signature is byte-identical to the legacy form', async () => {
  const url = join(dir, `sig-noopt-${++n}.db`)
  const adapter = await NativeAdapter.make({ driver: 'sqlite', url, connectionName: `sig-noopt-${n}` })
  try {
    assert.equal(cache().get(`sig-noopt-${n}`)!.signature, `sqlite::${url}`)
  } finally {
    await adapter.disconnect()
  }
})

test('present options append a distinct signature segment', async () => {
  const url = join(dir, `sig-opt-${++n}.db`)
  const adapter = await NativeAdapter.make({
    driver: 'sqlite', url, connectionName: `sig-opt-${n}`, options: { timeout: 1000 },
  })
  try {
    const sig = cache().get(`sig-opt-${n}`)!.signature
    assert.ok(sig.startsWith(`sqlite::${url}::options=`), `signature carries an options segment: ${sig}`)
    assert.notEqual(sig, `sqlite::${url}`)
  } finally {
    await adapter.disconnect()
  }
})

test('options signature is key-order independent', async () => {
  const url = join(dir, `sig-order-${++n}.db`)
  const connA = `sig-order-a-${n}`
  const a = await NativeAdapter.make({ driver: 'sqlite', url, connectionName: connA, options: { a: 1, b: 2 } })
  const sigA = cache().get(connA)!.signature
  await a.disconnect()

  const connB = `sig-order-b-${n}`
  const b = await NativeAdapter.make({ driver: 'sqlite', url, connectionName: connB, options: { b: 2, a: 1 } })
  const sigB = cache().get(connB)!.signature
  await b.disconnect()

  // Same options, different key order → identical signature (the connection
  // name is the cache KEY, never part of the signature itself).
  assert.equal(sigA, sigB)
})

test('two different options → different signatures → the cached driver is disposed and reopened', async () => {
  const url = join(dir, `sig-edit-${++n}.db`)
  const conn = `sig-edit-${n}`

  const first = await NativeAdapter.make({ driver: 'sqlite', url, connectionName: conn, options: { timeout: 1000 } })
  const sig1 = cache().get(conn)!.signature
  // Don't disconnect — simulate a dev re-boot: same connectionName, edited options.

  const second = await NativeAdapter.make({ driver: 'sqlite', url, connectionName: conn, options: { timeout: 2000 } })
  const sig2 = cache().get(conn)!.signature

  assert.notEqual(sig1, sig2, 'an options edit changes the signature')
  // The cache holds exactly one entry for the connection — the reopened one.
  assert.equal(cache().get(conn)!.signature, sig2)

  await second.disconnect()
  // `first` shares the (now-disposed) cache entry was already superseded; closing
  // it again is a no-op guard — its driver was closed by the supersede path.
  await first.disconnect().catch(() => { /* superseded driver already closing */ })
})

test('same options on a re-boot reuses the cached driver (signature unchanged)', async () => {
  const url = join(dir, `sig-reuse-${++n}.db`)
  const conn = `sig-reuse-${n}`

  const first = await NativeAdapter.make({ driver: 'sqlite', url, connectionName: conn, options: { timeout: 1000 } })
  const sig1 = cache().get(conn)!.signature
  const second = await NativeAdapter.make({ driver: 'sqlite', url, connectionName: conn, options: { timeout: 1000 } })
  const sig2 = cache().get(conn)!.signature

  assert.equal(sig1, sig2, 'identical options keep the signature stable → driver reused')
  await second.disconnect()
})

// ── live (gated) — options take real effect on the pooled drivers ──

const PG_URL = process.env['PG_TEST_URL']

test('live pg: options reach porsager (application_name session setting)', { skip: !PG_URL }, async () => {
  const adapter = await NativeAdapter.make({
    driver: 'pg', url: PG_URL!, connectionName: `pg-opts-${process.pid}`,
    options: { connection: { application_name: 'rudder_opts_probe' } },
  })
  try {
    const rows = await adapter.selectRaw('select current_setting($1) as v', ['application_name'])
    assert.equal(rows[0]?.v, 'rudder_opts_probe', 'the connection option reached the postgres() factory')
  } finally {
    await adapter.disconnect()
  }
})

const MYSQL_URL = process.env['MYSQL_TEST_URL']

test('live mysql: options reach mysql2 (multipleStatements)', { skip: !MYSQL_URL }, async () => {
  // Binary proof: without the option mysql2 rejects two `;`-separated statements
  // (the default `multipleStatements: false`); with it the call resolves — so the
  // option must have reached createPool().
  const off = await NativeAdapter.make({ driver: 'mysql', url: MYSQL_URL!, connectionName: `my-opts-off-${process.pid}` })
  try {
    await assert.rejects(() => off.selectRaw('select 1; select 2', []), /syntax/i)
  } finally {
    await off.disconnect()
  }

  const on = await NativeAdapter.make({
    driver: 'mysql', url: MYSQL_URL!, connectionName: `my-opts-on-${process.pid}`,
    options: { multipleStatements: true },
  })
  try {
    await on.selectRaw('select 1; select 2', []) // resolves — multi-statement allowed
  } finally {
    await on.disconnect()
  }
})
