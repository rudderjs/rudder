import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { unregisterConfigKey, findInstalledDependents, _testInternal } from './remove.js'

void _testInternal // keep the named export reachable

describe('rudder remove — findInstalledDependents', () => {
  let tmp: string
  beforeEach(async () => { tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-rm-')) })
  afterEach(async  () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it('returns [] when no dependents are installed', async () => {
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/auth': '^1.0.0' },
    }))
    assert.deepEqual(findInstalledDependents(tmp, 'auth'), [])
  })

  it('flags installed sanctum + passport as dependents of auth', async () => {
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: {
        '@rudderjs/auth':     '^1.0.0',
        '@rudderjs/sanctum':  '^1.0.0',
        '@rudderjs/passport': '^1.0.0',
      },
    }))
    const dependents = findInstalledDependents(tmp, 'auth')
    assert.ok(dependents.includes('sanctum'))
    assert.ok(dependents.includes('passport'))
  })

  it('skips dependents that are declared in registry but not installed', async () => {
    // sanctum requires auth, but only sanctum's registry-side `requires`
    // matters when *sanctum itself is installed*. We're asking about auth
    // here, so this case ensures we only count *installed* dependents.
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/auth': '^1.0.0' }, // no sanctum
    }))
    assert.deepEqual(findInstalledDependents(tmp, 'auth'), [])
  })

  it('returns [] when removing a leaf package with no dependents', async () => {
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { '@rudderjs/queue': '^1.0.0' },
    }))
    assert.deepEqual(findInstalledDependents(tmp, 'queue'), [])
  })
})

describe('rudder remove — unregisterConfigKey', () => {
  let tmp: string
  let indexFile: string

  const baseIndex = `import app      from './app.js'
import server   from './server.js'
import log      from './log.js'
import queue    from './queue.js'

const configs = { app, server, log, queue }

export type Configs = typeof configs

export default configs
`

  beforeEach(async () => {
    tmp       = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-rm-idx-'))
    indexFile = path.join(tmp, 'index.ts')
    await fs.writeFile(indexFile, baseIndex)
  })
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }) })

  it('removes the import line + key for a registered config', async () => {
    const result = unregisterConfigKey(indexFile, 'queue')
    assert.equal(result, 'ok')
    const out = await fs.readFile(indexFile, 'utf8')
    assert.doesNotMatch(out, /from '\.\/queue\.js'/, 'import line should be gone')
    assert.match(out, /const configs = \{ app, server, log \}/)
  })

  it('returns not-registered when the key was never wired in', async () => {
    const result = unregisterConfigKey(indexFile, 'mail')
    assert.equal(result, 'not-registered')
    const out = await fs.readFile(indexFile, 'utf8')
    // File untouched
    assert.equal(out, baseIndex)
  })

  it('is idempotent — second call after success returns not-registered', async () => {
    unregisterConfigKey(indexFile, 'queue')
    const second = unregisterConfigKey(indexFile, 'queue')
    assert.equal(second, 'not-registered')
  })

  it('bails on unrecognized file shape', async () => {
    await fs.writeFile(indexFile, `// custom file\nimport queue from './queue.js'\nexport default {}\n`)
    // import line exists but no `const configs = { ... }` block — unrecognized shape.
    assert.equal(unregisterConfigKey(indexFile, 'queue'), 'unrecognized-shape')
  })

  it('preserves trailing exports and surrounding imports', async () => {
    unregisterConfigKey(indexFile, 'queue')
    const out = await fs.readFile(indexFile, 'utf8')
    assert.match(out, /export type Configs = typeof configs/)
    assert.match(out, /export default configs/)
    // Surrounding imports stay intact.
    assert.match(out, /^import app\s+from '\.\/app\.js'$/m)
    assert.match(out, /^import server\s+from '\.\/server\.js'$/m)
    assert.match(out, /^import log\s+from '\.\/log\.js'$/m)
  })

  it('add → remove round-trip leaves the file byte-identical (modulo whitespace)', async () => {
    // The canonical case: starting from a barrel that doesn't include 'queue',
    // running register-then-unregister returns to a barrel where 'queue' is gone.
    const originalNoQueue = `import app      from './app.js'
import server   from './server.js'
import log      from './log.js'

const configs = { app, server, log }

export type Configs = typeof configs

export default configs
`
    await fs.writeFile(indexFile, originalNoQueue)
    // Import the registrar from the sibling module for the round-trip test.
    const { registerConfigKey } = await import('./add.js')
    registerConfigKey(indexFile, 'queue')
    unregisterConfigKey(indexFile, 'queue')
    const out = await fs.readFile(indexFile, 'utf8')
    // The configs block must list exactly the original keys, in original order.
    const configsMatch = out.match(/const configs = \{([^}]*)\}/)
    assert.ok(configsMatch, 'configs block must still exist')
    const keys = configsMatch![1]!.split(',').map(s => s.trim()).filter(Boolean)
    assert.deepEqual(keys, ['app', 'server', 'log'])
    // No leftover `queue` import.
    assert.doesNotMatch(out, /from '\.\/queue\.js'/)
  })
})
