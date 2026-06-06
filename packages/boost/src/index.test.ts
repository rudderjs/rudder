import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { getAppInfo } from './tools/app-info.js'
import { getDbSchema } from './tools/db-schema.js'
import { getConfigValue } from './tools/config-get.js'
import { getRouteList } from './tools/route-list.js'
import { getModelList } from './tools/model-list.js'
import { getLastError } from './tools/last-error.js'
import { listCommands } from './tools/commands-list.js'
import { runCommand } from './tools/command-run.js'
import { parseFirstJsonObject } from './tools/_pm.js'
import { createBoostServer, BoostProvider } from './index.js'
import { parseFrontmatter } from './frontmatter.js'
import { generateClaudeMd } from './generators/claude-md.js'

// Boost's integration tests drive the playground end-to-end — spawning
// `pnpm rudder` for command-list / route-list / run-command, parsing prisma
// schema, etc. Cross-platform fixture support (Windows path quirks, the
// pnpm.cmd shim, prisma generate) is out of scope for the CI portability
// matrix Phase 1. Re-evaluate when the scaffolder E2E job lands.
const skipOnWindows = { skip: process.platform === 'win32' ? 'boost playground integration tests need cross-platform fixture work' : false }

// Use the playgrounds as test projects. `playground/` runs the NATIVE engine
// (database/migrations/, no .prisma); its twin `playground-prisma/` keeps the
// Prisma schema — the fixture for the prisma-coupled tools (db_schema).
const PLAYGROUND        = join(import.meta.dirname, '..', '..', '..', 'playground')
const PLAYGROUND_PRISMA = join(import.meta.dirname, '..', '..', '..', 'playground-prisma')

// ─── app_info ─────────────────────────────────────────────

describe('getAppInfo', skipOnWindows, () => {
  it('returns project info from playground', () => {
    const info = getAppInfo(PLAYGROUND)
    assert.ok(info['name'])
    assert.ok(info['node'])
    assert.ok(Array.isArray(info['rudderPackages']))
    assert.ok((info['rudderPackages'] as unknown[]).length > 0)
  })

  it('detects pnpm as package manager', () => {
    const info = getAppInfo(PLAYGROUND)
    assert.strictEqual(info['packageManager'], 'pnpm')
  })

  it('returns error for missing directory', () => {
    const info = getAppInfo('/tmp/nonexistent-rudderjs-test')
    assert.ok(info['error'])
  })
})

// ─── db_schema ────────────────────────────────────────────

describe('getDbSchema', skipOnWindows, () => {
  it('parses prisma schema from playground-prisma', () => {
    const schema = getDbSchema(PLAYGROUND_PRISMA)
    assert.ok(schema.models.length > 0)
    const user = schema.models.find(m => m.name === 'User')
    assert.ok(user, 'User model should exist')
    assert.ok(user.fields.some(f => f.name === 'email'))
  })

  it('returns raw schema content', () => {
    const schema = getDbSchema(PLAYGROUND_PRISMA)
    assert.ok(schema.raw)
    assert.ok(schema.raw.includes('model User'))
  })

  it('returns empty for the native playground (no .prisma — known gap: db_schema is prisma-only)', () => {
    const schema = getDbSchema(PLAYGROUND)
    assert.strictEqual(schema.models.length, 0)
  })

  it('returns empty for missing schema', () => {
    const schema = getDbSchema('/tmp/nonexistent-rudderjs-test')
    assert.strictEqual(schema.models.length, 0)
  })
})

// ─── config_get ───────────────────────────────────────────

describe('getConfigValue', skipOnWindows, () => {
  it('lists config files when no key', () => {
    const result = getConfigValue(PLAYGROUND)
    assert.ok(typeof result === 'object')
    assert.ok(Array.isArray((result as Record<string, unknown>)['files']))
    assert.ok(((result as Record<string, unknown>)['files'] as string[]).includes('app'))
  })

  it('returns config file content for a key', () => {
    const result = getConfigValue(PLAYGROUND, 'app')
    assert.ok(typeof result === 'string')
    assert.ok(result.includes('APP_NAME') || result.includes('name'))
  })

  it('returns error for unknown key', () => {
    const result = getConfigValue(PLAYGROUND, 'nonexistent')
    assert.ok(typeof result === 'object')
    assert.ok((result as Record<string, unknown>)['error'])
  })
})

// ─── route_list ───────────────────────────────────────────

describe('getRouteList', skipOnWindows, () => {
  it('finds routes in playground', () => {
    const routes = getRouteList(PLAYGROUND)
    assert.ok(routes.length > 0)
    assert.ok(routes.some(r => r.path === '/api/health'))
  })

  it('detects HTTP methods', () => {
    const routes = getRouteList(PLAYGROUND)
    const methods = new Set(routes.map(r => r.method))
    assert.ok(methods.has('GET'))
    assert.ok(methods.has('POST'))
  })
})

// ─── model_list ───────────────────────────────────────────

describe('getModelList', skipOnWindows, () => {
  it('finds models in playground-prisma (delegate table names + declared fields)', () => {
    const models = getModelList(PLAYGROUND_PRISMA)
    assert.ok(models.length > 0)
    const user = models.find(m => m.name === 'User')
    assert.ok(user, 'User model should exist')
    assert.strictEqual(user.table, 'user')
    assert.ok(user.fields.length > 0)
  })

  it('finds models in the native playground (SQL table names)', () => {
    const models = getModelList(PLAYGROUND)
    assert.ok(models.length > 0)
    const user = models.find(m => m.name === 'User')
    assert.ok(user, 'User model should exist')
    assert.strictEqual(user.table, 'users')
    // Models bound via Model.for<>() declare no fields — boost's parser reads
    // hand-declared fields only (native typed-registry support is a known gap).
  })
})

// ─── last_error ───────────────────────────────────────────

describe('getLastError', skipOnWindows, () => {
  it('returns message when no logs found', () => {
    const lines = getLastError('/tmp/nonexistent-rudderjs-test')
    assert.ok(lines[0]!.includes('No log files'))
  })
})

// ─── createBoostServer ───────────────────────────────────

describe('createBoostServer', skipOnWindows, () => {
  it('creates an MCP server', () => {
    const server = createBoostServer(PLAYGROUND)
    assert.ok(server)
  })
})

// ─── parseFirstJsonObject ────────────────────────────────

describe('parseFirstJsonObject', () => {
  it('extracts JSON after a script-header preamble', () => {
    const stdout = '> playground@0.0.1 rudder\n> tsx index.ts command:list\n\n{"commands":[]}'
    const parsed = parseFirstJsonObject<{ commands: unknown[] }>(stdout)
    assert.deepStrictEqual(parsed, { commands: [] })
  })

  it('handles braces inside string values', () => {
    const stdout = `prelude {"description":"escape } here","ok":true}`
    const parsed = parseFirstJsonObject<{ description: string; ok: boolean }>(stdout)
    assert.strictEqual(parsed.description, 'escape } here')
    assert.strictEqual(parsed.ok, true)
  })

  it('throws when no JSON object present', () => {
    assert.throws(() => parseFirstJsonObject('no json here'))
  })
})

// ─── listCommands ────────────────────────────────────────

describe('listCommands', skipOnWindows, () => {
  it('returns built-in + package commands from playground', { timeout: 60_000 }, async () => {
    const result = await listCommands(PLAYGROUND)
    assert.ok(Array.isArray(result.commands))
    assert.ok(result.commands.length > 0, 'expected at least one command')
    const names = result.commands.map(c => c.name)
    assert.ok(names.includes('command:list'), 'expected command:list to be present')
    // make:* are package-contributed; one of them should be there
    assert.ok(names.some(n => n.startsWith('make:')), 'expected at least one make:* command')
  })

  it('filters by namespace', { timeout: 60_000 }, async () => {
    const result = await listCommands(PLAYGROUND, 'make')
    assert.ok(result.commands.length > 0)
    assert.ok(result.commands.every(c => c.name.startsWith('make:') || c.name === 'make'))
  })
})

// ─── runCommand ──────────────────────────────────────────

describe('runCommand', skipOnWindows, () => {
  it('runs a no-side-effect command and returns structured result', { timeout: 60_000 }, async () => {
    const result = await runCommand(PLAYGROUND, 'command:list', ['--all', '--json'], 30_000)
    assert.strictEqual(result.exitCode, 0)
    assert.strictEqual(result.killed, false)
    assert.ok(result.stdout.length > 0, 'expected stdout from command')
    assert.ok(result.durationMs >= 0)
  })

  it('returns non-zero exit code for unknown command', { timeout: 30_000 }, async () => {
    const result = await runCommand(PLAYGROUND, 'this:does:not:exist', [], 15_000)
    assert.notStrictEqual(result.exitCode, 0)
  })
})

// ─── BoostProvider ───────────────────────────────────────

describe('BoostProvider', () => {
  it('is a constructor', () => {
    assert.strictEqual(typeof BoostProvider, 'function')
  })
})

// ─── parseFrontmatter ────────────────────────────────────

describe('parseFrontmatter', () => {
  it('returns empty data + full body when no frontmatter', () => {
    const r = parseFrontmatter('# Hello\n\nNo frontmatter here.')
    assert.deepStrictEqual(r.data, {})
    assert.ok(r.body.startsWith('# Hello'))
  })

  it('parses scalar fields', () => {
    const r = parseFrontmatter('---\nname: orm-models\nlicense: MIT\n---\n\n# Body\n')
    assert.strictEqual(r.data['name'], 'orm-models')
    assert.strictEqual(r.data['license'], 'MIT')
    assert.ok(r.body.startsWith('# Body'))
  })

  it('parses array fields (block style)', () => {
    const r = parseFrontmatter(`---
appliesTo:
  - '@rudderjs/orm'
  - '@rudderjs/orm-prisma'
---

Body
`)
    assert.deepStrictEqual(r.data['appliesTo'], ['@rudderjs/orm', '@rudderjs/orm-prisma'])
  })

  it('parses nested object fields', () => {
    const r = parseFrontmatter(`---
metadata:
  author: rudderjs
  version: '1.0'
---
Body
`)
    assert.deepStrictEqual(r.data['metadata'], { author: 'rudderjs', version: '1.0' })
  })

  it('strips quotes from scalar values', () => {
    const r = parseFrontmatter(`---
trigger: "use when X happens"
skip: 'use when Y'
---
`)
    assert.strictEqual(r.data['trigger'], 'use when X happens')
    assert.strictEqual(r.data['skip'], 'use when Y')
  })
})

// ─── generateClaudeMd ────────────────────────────────────

describe('generateClaudeMd', () => {
  const sampleInput = {
    cwd: '/tmp/fake-project',
    packages: [
      { name: '@rudderjs/core', shortName: 'core', hasGuideline: true },
      { name: '@rudderjs/ai',   shortName: 'ai',   hasGuideline: true },
      { name: '@rudderjs/foo',  shortName: 'foo',  hasGuideline: false }, // no guideline
    ],
    skills: [
      {
        name:    'orm-models',
        trigger: 'editing a Model',
        skip:    'reading from a route handler',
      },
    ],
    nodeVersion: 'v22.0.0',
  }

  it('wraps output in <rudderjs-boost-guidelines> tags', () => {
    const out = generateClaudeMd(sampleInput)
    assert.ok(out.startsWith('<rudderjs-boost-guidelines>'))
    assert.ok(out.trimEnd().endsWith('</rudderjs-boost-guidelines>'))
  })

  it('emits the three section dividers', () => {
    const out = generateClaudeMd(sampleInput)
    assert.ok(out.includes('=== foundation rules ==='))
    assert.ok(out.includes('=== boost rules ==='))
    assert.ok(out.includes('=== skills activation ==='))
  })

  it('lists foundational context with node + every package', () => {
    const out = generateClaudeMd(sampleInput)
    assert.ok(out.includes('- node — v22.0.0'))
    assert.ok(out.includes('- @rudderjs/core'))
    assert.ok(out.includes('- @rudderjs/ai'))
    assert.ok(out.includes('- @rudderjs/foo'))
  })

  it('only emits pointer lines for packages with a guideline', () => {
    const out = generateClaudeMd(sampleInput)
    assert.ok(out.includes('`@rudderjs/core` → `.ai/guidelines/core.md`'))
    assert.ok(out.includes('`@rudderjs/ai` → `.ai/guidelines/ai.md`'))
    assert.ok(!out.includes('`@rudderjs/foo` → `.ai/guidelines/foo.md`'))
  })

  it('renders skill activation with trigger + skip', () => {
    const out = generateClaudeMd(sampleInput)
    assert.ok(out.includes('`orm-models` — **ACTIVATE when:** editing a Model. **SKIP when:** reading from a route handler.'))
  })

  it('lists every MCP tool', () => {
    const out = generateClaudeMd(sampleInput)
    for (const tool of ['app_info', 'db_schema', 'route_list', 'model_list', 'config_get', 'db_query', 'last_error', 'read_logs', 'browser_logs', 'get_absolute_url', 'search_docs', 'commands_list', 'command_run']) {
      assert.ok(out.includes(`\`${tool}\``), `expected MCP tool ${tool} in output`)
    }
  })

  it('produces a compact output under 200 lines for typical inputs', () => {
    const out = generateClaudeMd(sampleInput)
    const lines = out.split('\n').length
    assert.ok(lines < 200, `expected < 200 lines, got ${lines}`)
  })

  it('omits Skills Activation section when no skills supplied', () => {
    const out = generateClaudeMd({ ...sampleInput, skills: [] })
    assert.ok(!out.includes('=== skills activation ==='))
    assert.ok(!out.includes('# Skills Activation'))
  })
})
