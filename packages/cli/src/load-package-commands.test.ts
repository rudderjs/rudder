// loadPackageCommands() walk — end-to-end through the REAL CLI binary.
//
// The walk imports `<cwd>/node_modules/<pkg>/dist/commands/<subpath>.js` for
// each known package and registers what it finds; a per-loader `.catch()`
// swallows missing/broken modules. This exact walk previously regressed
// silently (bare-specifier dynamic imports resolved from the cli's own
// source dir under pnpm strict mode → every package-contributed make:* was a
// no-op in dev) and no test caught it, because loadPackageCommands is a
// private function inside the CLI's entry module.
//
// It still is — exporting it just for tests would be a production seam change
// this test-only batch avoids — so the test drives the published surface
// instead: spawn `node dist/index.js command:list --json` in a scratch app
// whose node_modules contains (a) a fake package command module that
// registers an inline command and (b) a package module that THROWS at import
// time. The fake command appearing in the JSON proves the walk imported and
// registered it from the scratch cwd; exit code 0 with the broken sibling
// present proves the silent-skip.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const prevCwd = process.cwd()
let root = ''

// Compiled test lives at dist-test/load-package-commands.test.js → the built
// CLI entry is a sibling tree at dist/index.js.
const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.js')

function writeCommandModule(pkg: string, subpath: string, contents: string): void {
  const pkgDir = path.join(root, 'node_modules', pkg)
  const file = path.join(pkgDir, 'dist', `${subpath}.js`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(path.join(pkgDir, 'package.json'))) {
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, type: 'module' }))
  }
  fs.writeFileSync(file, contents)
}

function runCommandList(): { status: number | null; payload: { commands: Array<{ name: string; source: string }> } } {
  const res = spawnSync(process.execPath, [CLI_ENTRY, 'command:list', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  })
  assert.equal(res.error, undefined, `spawn failed: ${res.error}`)
  const stdout = res.stdout
  const start = stdout.indexOf('{')
  assert.ok(start >= 0, `no JSON on stdout; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(res.stderr)}`)
  return { status: res.status, payload: JSON.parse(stdout.slice(start)) as { commands: Array<{ name: string; source: string }> } }
}

describe('loadPackageCommands — node_modules walk (via the real CLI binary)', () => {
  beforeEach(() => {
    assert.ok(fs.existsSync(CLI_ENTRY), `CLI must be built first (missing ${CLI_ENTRY}) — run pnpm build`)
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'load-pkg-commands-'))
  })

  afterEach(() => {
    process.chdir(prevCwd)
    fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('imports a package command module from <cwd>/node_modules and registers its command', () => {
    // The loader passes the rudder singleton in — the fake registers an
    // inline command through it, exactly like the real route-list module.
    writeCommandModule('@rudderjs/router', 'commands/route-list', [
      `export function registerRouteListCommand(rudder) {`,
      `  rudder.command('route:list', async () => {}).description('fake route list from walk fixture')`,
      `}`,
      '',
    ].join('\n'))

    const { status, payload } = runCommandList()
    assert.equal(status, 0)
    const cmd = payload.commands.find(c => c.name === 'route:list')
    assert.ok(cmd, `route:list must be registered by the walk; got: ${payload.commands.map(c => c.name).join(', ') || '(none)'}`)
    assert.equal(cmd.source, 'inline')
  })

  it('skips a module that throws at import time without killing the CLI or the other loaders', () => {
    writeCommandModule('@rudderjs/ai', 'commands/make-agent', `throw new Error('boom at import time')\n`)
    writeCommandModule('@rudderjs/router', 'commands/route-list', [
      `export function registerRouteListCommand(rudder) {`,
      `  rudder.command('route:list', async () => {}).description('survives the broken sibling')`,
      `}`,
      '',
    ].join('\n'))

    const { status, payload } = runCommandList()
    assert.equal(status, 0, 'a broken package module must not kill the CLI')
    assert.ok(payload.commands.some(c => c.name === 'route:list'), 'the healthy loader still registers')
  })

  it('a bare app with no package modules still lists cleanly (everything skipped)', () => {
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
    const { status, payload } = runCommandList()
    assert.equal(status, 0)
    assert.ok(Array.isArray(payload.commands))
    assert.ok(!payload.commands.some(c => c.name === 'route:list'))
  })
})
