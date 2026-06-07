// module:publish end-to-end through the REAL command wiring (commander
// action), against a tmp project dir. Scaffolded apps use Prisma's multi-file
// layout (`prisma.config.ts` → schema: 'prisma/schema'), so merging into a
// sibling `prisma/schema.prisma` writes a file Prisma never reads — the
// publish was a silent no-op for every scaffolded app. These tests pin the
// layout-aware target.
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { publishModule, resolveSchemaTarget, MARKERS_RE } from './publish.js'

function scaffoldModules(cwd: string): void {
  mkdirSync(join(cwd, 'app', 'Modules', 'Todo'), { recursive: true })
  writeFileSync(
    join(cwd, 'app', 'Modules', 'Todo', 'Todo.prisma'),
    'model Todo {\n  id    Int    @id @default(autoincrement())\n  title String\n}\n',
  )
}

async function runPublish(cwd: string): Promise<void> {
  const prevCwd = process.cwd()
  // Swallow clack's raw ANSI output (intro/outro/spinner cursor codes) — it
  // intermittently corrupts the node:test default-reporter stream ("Unable to
  // deserialize cloned data due to invalid or unsupported version", ~1/3 runs).
  const prevWrite = process.stdout.write
  process.stdout.write = (() => true) as typeof process.stdout.write
  process.chdir(cwd)
  try {
    const program = new Command()
    program.exitOverride()
    publishModule(program)
    await program.parseAsync(['module:publish'], { from: 'user' })
  } finally {
    process.chdir(prevCwd)
    process.stdout.write = prevWrite
  }
}

describe('module:publish end-to-end (real command wiring)', () => {
  let cwd: string
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'rudder-module-publish-')) })
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }) })

  it('multi-file layout: merges into prisma/schema/modules.prisma (the dir Prisma reads)', async () => {
    scaffoldModules(cwd)
    mkdirSync(join(cwd, 'prisma', 'schema'), { recursive: true })
    writeFileSync(join(cwd, 'prisma', 'schema', 'base.prisma'), 'datasource db { provider = "sqlite" }\n')

    await runPublish(cwd)

    const target = join(cwd, 'prisma', 'schema', 'modules.prisma')
    assert.ok(existsSync(target), 'modules.prisma should be written into prisma/schema/')
    const content = readFileSync(target, 'utf8')
    assert.match(content, /model Todo/)
    assert.match(content, MARKERS_RE)
    // The legacy single-file target must NOT appear next to a multi-file layout.
    assert.ok(!existsSync(join(cwd, 'prisma', 'schema.prisma')),
      'must not write prisma/schema.prisma when prisma/schema/ exists — Prisma never reads it there')
  })

  it('multi-file layout: re-publish replaces the marker block idempotently', async () => {
    scaffoldModules(cwd)
    mkdirSync(join(cwd, 'prisma', 'schema'), { recursive: true })

    await runPublish(cwd)
    writeFileSync(
      join(cwd, 'app', 'Modules', 'Todo', 'Todo.prisma'),
      'model Todo {\n  id   Int     @id @default(autoincrement())\n  done Boolean @default(false)\n}\n',
    )
    await runPublish(cwd)

    const content = readFileSync(join(cwd, 'prisma', 'schema', 'modules.prisma'), 'utf8')
    assert.match(content, /done\s+Boolean/)
    assert.equal(content.match(/<rudderjs:modules:start>/g)?.length, 1, 'one marker block after re-publish')
  })

  it('legacy single-file layout: merges into prisma/schema.prisma', async () => {
    scaffoldModules(cwd)
    mkdirSync(join(cwd, 'prisma'), { recursive: true })
    writeFileSync(join(cwd, 'prisma', 'schema.prisma'), 'datasource db { provider = "sqlite" }\n')

    await runPublish(cwd)

    const content = readFileSync(join(cwd, 'prisma', 'schema.prisma'), 'utf8')
    assert.match(content, /datasource db/, 'existing schema content preserved')
    assert.match(content, /model Todo/)
  })
})

describe('resolveSchemaTarget', () => {
  it('prefers the prisma/schema directory when present', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rudder-schema-target-'))
    try {
      assert.ok(resolveSchemaTarget(cwd).endsWith(join('prisma', 'schema.prisma')))
      mkdirSync(join(cwd, 'prisma', 'schema'), { recursive: true })
      assert.ok(resolveSchemaTarget(cwd).endsWith(join('prisma', 'schema', 'modules.prisma')))
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
