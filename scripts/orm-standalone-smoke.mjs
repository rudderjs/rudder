// Standalone-Node certification for @rudderjs/orm.
//
// Proves the ORM works as a plain library in a project with NO Rudder framework
// and NO @rudderjs/console — the "works in any Node app" goal of the native ORM
// plan (docs/plans/2026-05-30-native-orm-adapter.md).
//
// What the in-repo conformance suite CAN'T catch: it runs where every
// @rudderjs/* package is workspace-linked, so it never exercises the published
// `exports` map or the real dependency graph. This packs the package the way
// npm consumers get it and installs it OUTSIDE the workspace, so it catches
// packaging regressions — a missing `exports` subpath, or a hard dependency
// (e.g. @rudderjs/console) creeping back into the install.
//
// Steps:
//   1. `pnpm pack` @rudderjs/orm + its runtime deps @rudderjs/contracts and
//      @rudderjs/database (pnpm rewrites the `workspace:^` range to the real
//      version in the tarball). database is packed locally because it isn't
//      published to npm yet — orm depends on it via the PR1 data-layer edge, so
//      a registry install would 404 until the first @rudderjs/database release.
//   2. Scaffold a throwaway project that depends on those three tarballs +
//      better-sqlite3 (the optional peer) — nothing else.
//   3. `npm install` outside the monorepo (no workspace linking).
//   4. Assert @rudderjs/console was NOT pulled in.
//   5. Run a real Model round-trip against in-memory SQLite (create / all /
//      where(boolean) / find / boolean-cast), driving the public entry points
//      only (@rudderjs/orm + @rudderjs/orm/native).
//
// Requires orm + contracts to be built (dist/) first. Run: node scripts/orm-standalone-smoke.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const log = (m) => console.log(`[orm-standalone-smoke] ${m}`)
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

const work = mkdtempSync(join(tmpdir(), 'orm-standalone-'))
const tarDir = join(work, 'tarballs')
const proj = join(work, 'app')
mkdirSync(tarDir)
mkdirSync(proj)
log(`work dir: ${work}`)

let failed = false
try {
  // 1. Pack orm + its runtime deps contracts and database. `pnpm pack` rewrites
  //    `workspace:^` to the resolved version, so each tarball is what npm
  //    consumers would get. database must be packed locally too — it's the new
  //    PR1 data-layer dep of orm and isn't on npm yet, so a registry resolve 404s.
  for (const pkg of ['contracts', 'database', 'orm']) {
    log(`packing @rudderjs/${pkg}`)
    sh('pnpm', ['pack', '--pack-destination', tarDir], join(repoRoot, 'packages', pkg))
  }
  const tarballs = readdirSync(tarDir)
  const tgz = (prefix) => {
    const f = tarballs.find((t) => t.startsWith(prefix))
    if (!f) throw new Error(`no tarball matching ${prefix} in ${tarballs.join(', ')}`)
    return join(tarDir, f)
  }
  const ormTgz = tgz('rudderjs-orm-')
  const contractsTgz = tgz('rudderjs-contracts-')
  const databaseTgz = tgz('rudderjs-database-')

  // 2. Throwaway project: the three tarballs + better-sqlite3 from npm. No Rudder
  //    framework, no @rudderjs/console — exactly a plain Node consumer.
  writeFileSync(
    join(proj, 'package.json'),
    JSON.stringify(
      {
        name: 'orm-standalone-smoke',
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: {
          '@rudderjs/orm': `file:${ormTgz}`,
          '@rudderjs/contracts': `file:${contractsTgz}`,
          '@rudderjs/database': `file:${databaseTgz}`,
          'better-sqlite3': '^12.0.0',
        },
      },
      null,
      2,
    ),
  )

  // 3. Install with npm (outside the workspace → no pnpm workspace linking).
  log('npm install (tarballs + better-sqlite3 from npm)')
  sh('npm', ['install', '--no-audit', '--no-fund'], proj)

  // 4. The decoupling proof: @rudderjs/console must not have been pulled in.
  if (existsSync(join(proj, 'node_modules', '@rudderjs', 'console'))) {
    throw new Error(
      'FAIL: @rudderjs/console was installed into a standalone consumer — the optional-peer decoupling regressed (a hard dependency crept back).',
    )
  }
  log('✓ @rudderjs/console absent from a standalone install')

  // 5. Real Model round-trip through the public entry points only.
  writeFileSync(
    join(proj, 'smoke.mjs'),
    `import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { NativeAdapter, BetterSqlite3Driver } from '@rudderjs/orm/native'

class Todo extends Model {
  static table = 'todos'
  static casts = { done: 'boolean' }
}

// Standalone DDL: no migrations under GATE B, so use the driver directly,
// then hand it to the adapter. This is the documented standalone setup.
const driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
await driver.execute('CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, done INTEGER)', [])
ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))

const a = await Todo.create({ title: 'first', done: false })
const b = await Todo.create({ title: 'second', done: true })
assert.equal(typeof a.id, 'number', 'create returns a generated id')
assert.ok(b)

const all = await Todo.all()
assert.equal(all.length, 2, 'all() returns both rows')

// Exercises the raw-boolean binding fix (#803) in a standalone install.
const done = await Todo.query().where('done', true).get()
assert.equal(done.length, 1, 'where(boolean) filters')
assert.equal(done[0].title, 'second')

const found = await Todo.find(a.id)
assert.equal(found.title, 'first', 'find by id')
assert.equal(found.toJSON().done, false, 'boolean cast round-trips on toJSON')

await driver.close()
console.log('[orm-standalone-smoke] ✓ ORM round-trip OK (create / all / where(boolean) / find / cast)')
`,
  )
  log('running standalone ORM round-trip')
  sh('node', ['smoke.mjs'], proj)

  log('✓ PASS — @rudderjs/orm works standalone in a plain Node project')
} catch (err) {
  failed = true
  console.error(`[orm-standalone-smoke] ✗ FAIL: ${err.message}`)
} finally {
  // Best-effort cleanup; leave the dir on failure for inspection in local runs.
  if (!failed) {
    try {
      rmSync(work, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  } else {
    log(`left work dir for inspection: ${work}`)
  }
}

process.exit(failed ? 1 : 0)
