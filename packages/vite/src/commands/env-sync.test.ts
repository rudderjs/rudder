import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { registerEnvSyncCommand } from './env-sync.js'

let root = ''
const prevCwd = process.cwd()

function write(rel: string, contents: string): void {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

/** Register the command against a fake rudder and return the handler. */
function handler(): (args: string[]) => void | Promise<void> {
  const handlers: Record<string, (args: string[]) => void | Promise<void>> = {}
  registerEnvSyncCommand({
    command(name, h) {
      handlers[name] = h
      return { description() { return this } }
    },
  })
  const h = handlers['env:sync']
  assert.ok(h, 'env:sync registered')
  return h
}

/** Run the handler with --json and parse its single console.log payload. */
async function runJson(args: string[] = []): Promise<Record<string, unknown>> {
  const logs: string[] = []
  const orig = console.log
  console.log = (msg: unknown) => { logs.push(String(msg)) }
  try {
    await handler()([...args, '--json'])
  } finally {
    console.log = orig
  }
  return JSON.parse(logs.join('\n')) as Record<string, unknown>
}

describe('env:sync command', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'env-sync-cmd-'))
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(prevCwd)
    fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('reports cleanly when no .env.example exists', async () => {
    const out = await runJson()
    assert.equal(out['exampleExists'], false)
  })

  it('regenerates env.d.ts and reports missing .env keys', async () => {
    write('.env.example', 'APP_NAME=demo\nPORT=3000\nAUTH_SECRET=change-me\n')
    write('.env', 'APP_NAME=real\nLOCAL_ONLY=1\n')
    const out = await runJson()
    assert.equal(out['keyCount'], 3)
    assert.deepEqual(out['missing'], ['PORT', 'AUTH_SECRET'])
    assert.deepEqual(out['extra'], ['LOCAL_ONLY'])
    assert.equal(out['fixed'], false)
    assert.ok(fs.existsSync(path.join(root, '.rudder', 'types', 'env.d.ts')))
  })

  it('--fix appends missing keys with their example values', async () => {
    write('.env.example', 'APP_NAME=demo\nPORT=3000\n')
    write('.env', 'APP_NAME=real\n')
    const out = await runJson(['--fix'])
    assert.equal(out['fixed'], true)
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8')
    assert.match(env, /APP_NAME=real/)          // untouched
    assert.match(env, /PORT=3000/)              // appended with example value
    assert.match(env, /Added by `rudder env:sync --fix`/)
  })

  it('--fix creates .env from .env.example when absent', async () => {
    write('.env.example', 'APP_NAME=demo\n# a comment\nPORT=3000\n')
    const out = await runJson(['--fix'])
    assert.equal(out['fixed'], true)
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8')
    assert.equal(env, fs.readFileSync(path.join(root, '.env.example'), 'utf8'))
  })

  it('never removes extra .env keys, even with --fix (report-only)', async () => {
    write('.env.example', 'APP_NAME=demo\n')
    write('.env', 'APP_NAME=real\nLOCAL_ONLY=keep-me\n')
    const out = await runJson(['--fix'])
    assert.deepEqual(out['extra'], ['LOCAL_ONLY'])
    assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), /LOCAL_ONLY=keep-me/)
  })

  it('is idempotent — a second --fix run appends nothing', async () => {
    write('.env.example', 'APP_NAME=demo\nPORT=3000\n')
    write('.env', 'APP_NAME=real\n')
    await runJson(['--fix'])
    const after = fs.readFileSync(path.join(root, '.env'), 'utf8')
    const out = await runJson(['--fix'])
    assert.deepEqual(out['missing'], [])
    assert.equal(out['fixed'], false)
    assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), after)
  })
})
