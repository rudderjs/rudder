// ─── GATE 7-types — end-to-end "types story" round-trip ───────────────────────
//
// The seam these tests close: every OTHER 7-types test exercises ONE half of the
// pipeline against a FABRICATED input.
//   • types-generator.test.ts — pure type-mapping, hand-built columns.
//   • schema-types.test.ts     — generator runs on a live DB, asserts file TEXT.
//   • model-for.test.ts        — Model.for<>() consumes a HAND-WRITTEN augmentation.
// Nothing wires the REAL generator's output into a REAL model and proves a typed
// consumer compiles — so a regression in how the generator names/shapes columns
// would pass every existing test while silently breaking apps.
//
// Here we run the actual `generateSchemaTypes(...)` (the same function the
// `schema:types` command + the post-migrate hook call) against a live DB, write
// the real `.rudder/types/models.d.ts`, drop a model that does
// `extends Model.for<'rudder_types_story'>()` next to it, and spawn `tsc --noEmit` over the
// pair. Two controls pin it from both sides:
//   • POSITIVE — correct typed usage + `@ts-expect-error` on a missing column
//     MUST compile. (Catches a fallback to the open `Record<string, never>`: the
//     missing-column access would stop erroring and the `@ts-expect-error` would
//     go unused → tsc fails.)
//   • NEGATIVE — deliberately wrong assignments (`string = <boolean col>`,
//     `string = <nullable col>`) MUST fail to compile. (Catches the columns
//     degrading to `any`/`never`, which the positive side can't distinguish.)
//
// Runs against SQLite always; against Postgres when PG_TEST_URL is set (same gate
// as the other live pg suites). `@rudderjs/orm` is path-mapped to the freshly
// emitted `dist-test/index.d.ts` (the test's own `tsc` step writes it, so it is
// present in every CI job regardless of build order), `@rudderjs/contracts` to
// its built `dist`.

import { describe, it, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import { PostgresDriver } from '@rudderjs/database/native'
import { SqliteDialect, type Dialect } from '@rudderjs/database/native'
import { PgDialect } from '@rudderjs/database/native'
import type { Executor } from '@rudderjs/database/native'
import { SchemaBuilder } from '@rudderjs/database/native'
import type { Blueprint } from '@rudderjs/database/native'
import { generateSchemaTypes, type ModelCastInfo } from '@rudderjs/database/native'

// node --test runs from the package dir (packages/orm); turbo keeps the same cwd.
const ormRoot = process.cwd()
const repoRoot = join(ormRoot, '..', '..')
const ormDts = join(ormRoot, 'dist-test', 'index.d.ts')
const contractsDts = join(repoRoot, 'packages', 'contracts', 'dist', 'index.d.ts')

const require_ = createRequire(join(ormRoot, 'noop.js'))
// Run tsc as `node <typescript/bin/tsc>` rather than the `node_modules/.bin/tsc`
// shim: on Windows the shim is `tsc.cmd`, which execFileSync can't exec directly
// (it needs a shell) — the JS entry runs identically on every platform.
const tscJs = require_.resolve('typescript/bin/tsc')
// @types/node is pnpm-hoisted under a versioned .pnpm path — resolve it rather
// than hardcode, so the spawned tsc finds node typings on any machine.
const nodeTypesRoot = dirname(dirname(require_.resolve('@types/node/package.json')))

// The model the generated registry types — declares the `active` boolean cast so
// the generator refines the stored integer/boolean column to `boolean`. Shared
// by the spawned fixtures (written verbatim into the temp project).
const MODEL_SRC = `import { Model } from '@rudderjs/orm'
export class Account extends Model.for<'rudder_types_story'>() {
  static override table = 'rudder_types_story'
  static override casts = { active: 'boolean' as const }
}
`

// Passed to the generator so the boolean cast folds into the emitted types,
// mirroring what collectRegisteredModelCasts() yields at runtime.
const MODELS: ModelCastInfo[] = [{ table: 'rudder_types_story', casts: { active: 'boolean' } }]

// tsc accepts forward slashes on every platform; normalizing avoids Windows
// backslashes landing in (and being escaped through) the JSON tsconfig.
const fwd = (p: string): string => p.replace(/\\/g, '/')

function writeTsconfig(root: string, files: string[]): string {
  const path = join(root, 'tsconfig.json')
  writeFileSync(
    path,
    JSON.stringify(
      {
        extends: fwd(join(repoRoot, 'tsconfig.base.json')),
        compilerOptions: {
          noEmit: true,
          // Plain diagnostics (no ANSI/code-frames) so the negative control's
          // message assertions are stable whether or not CI forces color.
          pretty: false,
          // Bundler resolution keeps the path-mapped `.d.ts` + extension-less
          // '@rudderjs/orm' import resolvable without NodeNext's extension rules;
          // module augmentation still merges by specifier.
          module: 'ESNext',
          moduleResolution: 'Bundler',
          skipLibCheck: true,
          types: ['node'],
          typeRoots: [fwd(nodeTypesRoot)],
          baseUrl: fwd(root),
          paths: {
            '@rudderjs/orm': [fwd(ormDts)],
            '@rudderjs/contracts': [fwd(contractsDts)],
          },
        },
        files: files.map(fwd),
      },
      null,
      2,
    ),
  )
  return path
}

/** Spawn the real tsc over a tsconfig. Returns the exit code + combined output. */
function typecheck(tsconfigPath: string): { ok: boolean; output: string } {
  try {
    execFileSync(process.execPath, [tscJs, '-p', tsconfigPath], { stdio: 'pipe', encoding: 'utf8' })
    return { ok: true, output: '' }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string }
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

/** Build the `rudder_types_story` table on a live connection through the real DDL path. */
async function buildTable(executor: Executor, dialect: Dialect): Promise<void> {
  const schema = new SchemaBuilder(executor, dialect)
  await schema.dropIfExists('rudder_types_story')
  await schema.create('rudder_types_story', (t: Blueprint) => {
    t.id() //               → id: number
    t.string('name') //     → name: string (NOT NULL)
    t.string('email').nullable() // → email: string | null
    t.boolean('active') //  stored int/bool, cast 'boolean' → active: boolean
  })
}

function runDialectSuite(label: string, makeConn: () => Promise<{ executor: Executor; dialect: Dialect; close: () => Promise<void> }>): void {
  describe(`types story E2E — ${label}`, () => {
    let conn: { executor: Executor; dialect: Dialect; close: () => Promise<void> }
    let root: string

    before(async () => {
      // Pre-req: the test's own `tsc -p tsconfig.test.json` step emitted these.
      assert.ok(existsSync(ormDts), `expected ${ormDts} (orm test compile output)`)
      assert.ok(existsSync(contractsDts), `expected ${contractsDts} (build @rudderjs/contracts first)`)

      conn = await makeConn()
      await buildTable(conn.executor, conn.dialect)

      root = mkdtempSync(join(tmpdir(), `types-story-${label}-`))
      // Generate the REAL registry.d.ts from the live schema — same call as the
      // schema:types command + post-migrate hook.
      const { tableCount } = await generateSchemaTypes(conn.executor, conn.dialect, root, MODELS)
      assert.ok(tableCount >= 1, 'generator should discover the rudder_types_story table')
      assert.ok(
        existsSync(join(root, '.rudder', 'types', 'models.d.ts')),
        'models.d.ts should be written under .rudder/types',
      )
      writeFileSync(join(root, 'Account.ts'), MODEL_SRC)
    })

    after(async () => {
      if (conn) {
        const schema = new SchemaBuilder(conn.executor, conn.dialect)
        await schema.dropIfExists('rudder_types_story')
        await conn.close()
      }
      if (root) rmSync(root, { recursive: true, force: true })
    })

    it('a model bound via Model.for<>() type-checks against the generated registry', () => {
      const registry = join(root, '.rudder', 'types', 'models.d.ts')
      writeFileSync(
        join(root, 'consume.ts'),
        `import { Account } from './Account.js'
async function usage() {
  const a = await Account.find(1)
  if (!a) return
  const id: number = a.id
  const name: string = a.name
  const email: string | null = a.email
  const active: boolean = a.active
  // @ts-expect-error — 'nope' is not a generated column; the registry shape is closed.
  const nope = a.nope
  return { id, name, email, active, nope }
}
void usage
`,
      )
      const tsconfig = writeTsconfig(root, ['./Account.ts', './consume.ts', registry])
      const { ok, output } = typecheck(tsconfig)
      assert.ok(ok, `positive fixture should compile, got:\n${output}`)
    })

    it('rejects type-incorrect usage (columns are precise, not any/never)', () => {
      const registry = join(root, '.rudder', 'types', 'models.d.ts')
      writeFileSync(
        join(root, 'consume-negative.ts'),
        `import { Account } from './Account.js'
async function bad() {
  const a = await Account.find(1)
  if (!a) return
  const wrongBool: string = a.active // boolean is not assignable to string
  const wrongNull: string = a.email  // string | null is not assignable to string
  const missing = a.totallyNotAColumn // closed shape has no such property
  return { wrongBool, wrongNull, missing }
}
void bad
`,
      )
      const tsconfig = writeTsconfig(root, ['./Account.ts', './consume-negative.ts', registry])
      const { ok, output } = typecheck(tsconfig)
      assert.ok(!ok, 'negative fixture must fail to compile')
      // Each deliberate error must actually fire — proves all three checks are
      // load-bearing, not masked by a single early failure. tsc reports types
      // (not source column names), so assert on the diagnostic each one yields:
      //   active  → boolean column,  assigned to string
      //   email   → nullable column, assigned to string
      //   bad col → property absent on the closed registry shape
      assert.match(output, /Type 'boolean' is not assignable to type 'string'/, 'active is precisely boolean')
      assert.match(output, /Type 'string \| null' is not assignable to type 'string'/, 'email is precisely string | null')
      assert.match(output, /Property 'totallyNotAColumn' does not exist/, 'the registry shape is closed')
    })
  })
}

runDialectSuite('sqlite', async () => {
  const driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  return { executor: driver, dialect: new SqliteDialect(), close: () => driver.close() }
})

const PG_URL = process.env['PG_TEST_URL']
if (!PG_URL) {
  test('types story E2E — pg (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  runDialectSuite('pg', async () => {
    const driver = await PostgresDriver.open({ url: PG_URL })
    return { executor: driver, dialect: new PgDialect(), close: () => driver.close() }
  })
}
