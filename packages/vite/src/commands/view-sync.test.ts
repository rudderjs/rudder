// view:sync command entry — mirrors env-sync.test.ts (the one sync command
// that had entry tests). The scanner core is covered by views-scanner.test.ts;
// this pins the CLI wiring: registration name, --json payload, generated
// outputs, and the --json error envelope on a scanner throw.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { registerViewSyncCommand } from './view-sync.js'

let root = ''
const prevCwd = process.cwd()

function write(rel: string, contents: string): void {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

/** Write a fake installed renderer (just enough for the scanner's fs probe). */
function installPkg(name: string): void {
  const dir = path.join(root, 'node_modules', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0', main: 'index.js' }))
  fs.writeFileSync(path.join(dir, 'index.js'), '')
}

/** Register the command against a fake rudder and return the handler. */
function handler(): (args: string[]) => void | Promise<void> {
  const handlers: Record<string, (args: string[]) => void | Promise<void>> = {}
  registerViewSyncCommand({
    command(name, h) {
      handlers[name] = h
      return { description() { return this } }
    },
  })
  const h = handlers['view:sync']
  assert.ok(h, 'view:sync registered')
  return h
}

/** Run the handler with --json, capturing console.log + any process.exit. */
async function runJson(args: string[] = []): Promise<{ out: Record<string, unknown>; exitCode: number | undefined }> {
  const logs: string[] = []
  const origLog = console.log
  const origExit = process.exit
  let exitCode: number | undefined
  console.log = (msg: unknown) => { logs.push(String(msg)) }
  // view:sync calls process.exit(1) on a scanner throw — capture instead of dying.
  process.exit = ((code?: number) => { exitCode = code }) as typeof process.exit
  try {
    await handler()([...args, '--json'])
  } finally {
    console.log = origLog
    process.exit = origExit
  }
  return { out: JSON.parse(logs.join('\n')) as Record<string, unknown>, exitCode }
}

describe('view:sync command', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'view-sync-cmd-'))
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture' }))
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(prevCwd)
    fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('reports cleanly when no app/Views directory exists', async () => {
    const { out, exitCode } = await runJson()
    assert.equal(out['viewsRootExists'], false)
    assert.equal(exitCode, undefined)
  })

  it('generates pages/__view + views.d.ts and reports counts (vanilla)', async () => {
    write('app/Views/Home.ts', 'export interface Props { title: string }\n')
    write('app/Views/About.ts', '// untyped view\n')
    fs.mkdirSync(path.join(root, 'pages'), { recursive: true })

    const { out, exitCode } = await runJson()
    assert.equal(exitCode, undefined)
    assert.equal(out['viewsRootExists'], true)
    assert.equal(out['framework'], 'vanilla')
    assert.equal(out['viewCount'], 2)
    assert.equal(out['typedCount'], 1)
    assert.ok(fs.existsSync(path.join(root, 'pages', '__view', 'home')))
    assert.ok(fs.existsSync(path.join(root, 'pages', '__view', 'about')))
    assert.match(fs.readFileSync(path.join(root, '.rudder', 'types', 'views.d.ts'), 'utf8'), /home/)
  })

  it('--json error envelope + exit 1 when the scanner throws (multiple renderers)', async () => {
    write('app/Views/Home.tsx', '// placeholder\n')
    fs.mkdirSync(path.join(root, 'pages'), { recursive: true })
    installPkg('vike-react')
    installPkg('vike-vue') // two renderers → detectFramework throws

    const { out, exitCode } = await runJson()
    assert.equal(exitCode, 1)
    assert.match(String(out['error']), /Multiple Vike renderers/)
  })
})
