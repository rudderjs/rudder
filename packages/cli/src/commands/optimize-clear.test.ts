import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearFrameworkCaches } from './optimize-clear.js'

describe('optimize:clear — clearFrameworkCaches', () => {
  let cwd: string

  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'rudder-optimize-clear-')) })
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }) })

  it('removes bootstrap/cache and node_modules/.vite when present', () => {
    mkdirSync(join(cwd, 'bootstrap', 'cache'), { recursive: true })
    writeFileSync(join(cwd, 'bootstrap', 'cache', 'providers.json'), '{}')
    mkdirSync(join(cwd, 'node_modules', '.vite', 'deps'), { recursive: true })

    const results = clearFrameworkCaches(cwd)

    assert.deepEqual(results.map(r => ({ target: r.target, cleared: r.cleared })), [
      { target: 'bootstrap/cache/',    cleared: true },
      { target: 'node_modules/.vite/', cleared: true },
    ])
    assert.ok(!existsSync(join(cwd, 'bootstrap', 'cache')))
    assert.ok(!existsSync(join(cwd, 'node_modules', '.vite')))
  })

  it('reports already-empty targets without failing', () => {
    const results = clearFrameworkCaches(cwd) // nothing exists
    assert.ok(results.every(r => r.cleared === false))
  })

  it('never touches committed generated dirs', () => {
    mkdirSync(join(cwd, '.rudder', 'types'), { recursive: true })
    writeFileSync(join(cwd, '.rudder', 'types', 'models.d.ts'), '// typed registry')
    mkdirSync(join(cwd, 'pages', '__view'), { recursive: true })
    writeFileSync(join(cwd, 'pages', '__view', 'stub.ts'), '// vike stub')

    clearFrameworkCaches(cwd)

    assert.ok(existsSync(join(cwd, '.rudder', 'types', 'models.d.ts')))
    assert.ok(existsSync(join(cwd, 'pages', '__view', 'stub.ts')))
  })
})
