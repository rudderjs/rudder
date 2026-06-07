// routes:sync command entry — mirrors env-sync.test.ts (the one sync command
// that had entry tests). The scanner core is covered by routes-scanner.test.ts;
// this pins the CLI wiring: registration name, --json payload, output file.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { registerRoutesSyncCommand } from './routes-sync.js'

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
  registerRoutesSyncCommand({
    command(name, h) {
      handlers[name] = h
      return { description() { return this } }
    },
  })
  const h = handlers['routes:sync']
  assert.ok(h, 'routes:sync registered')
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

describe('routes:sync command', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-sync-cmd-'))
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(prevCwd)
    fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('reports cleanly when no routes/ directory exists', async () => {
    const out = await runJson()
    assert.equal(out['routesDirExists'], false)
  })

  it('regenerates routes.d.ts from routes/*.ts and reports the count', async () => {
    write('routes/web.ts', [
      `router.get('/dashboard', h).name('dashboard')`,
      `router.post('/posts', h).name('posts.store')`,
      '',
    ].join('\n'))
    const out = await runJson()
    assert.equal(out['routesDirExists'], true)
    assert.equal(out['routeCount'], 2)
    const dts = fs.readFileSync(path.join(root, '.rudder', 'types', 'routes.d.ts'), 'utf8')
    assert.match(dts, /dashboard/)
    assert.match(dts, /posts\.store/)
  })

  it('human output summarizes the scan (no --json)', async () => {
    write('routes/web.ts', `router.get('/a', h).name('a')\n`)
    const logs: string[] = []
    const orig = console.log
    console.log = (msg: unknown) => { logs.push(String(msg)) }
    try {
      await handler()([])
    } finally {
      console.log = orig
    }
    assert.match(logs.join('\n'), /Scanned 1 named route/)
  })
})
