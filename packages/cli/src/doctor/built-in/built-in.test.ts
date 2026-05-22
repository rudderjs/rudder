import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { runChecks } from '../orchestrator.js'
import { loadBuiltInChecks } from './index.js'

// Built-in checks register themselves via side-effect imports — fires once
// per process. Load at file scope; the registry stays populated for the file,
// and tests differentiate themselves via cwd + filesystem fixtures.
loadBuiltInChecks()

let tmpDir: string
let originalCwd: string

before(() => {
  originalCwd = process.cwd()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudder-doctor-test-'))
})

after(() => {
  process.chdir(originalCwd)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  // Wipe + re-create the temp app dir so each test starts from blank slate.
  // On Windows, `rmSync` fails with EBUSY if we're chdir'd into the target —
  // step out to `originalCwd` first, then back in after re-creating.
  process.chdir(originalCwd)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  process.chdir(tmpDir)
  // Built-in checks read process.env; clear the ones we touch so the tests
  // don't accidentally inherit the parent process's value.
  delete process.env['APP_KEY']
  delete process.env['APP_ENV']
  delete process.env['DATABASE_URL']
})

function writeFile(rel: string, content: string): void {
  const full = path.join(tmpDir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
}

function outcomeFor(outcomes: { id: string }[], id: string): { id: string; status: string; message: string; fix?: string } {
  const o = outcomes.find(x => x.id === id)
  assert.ok(o, `expected outcome '${id}', got: ${outcomes.map(x => x.id).join(', ')}`)
  return o as { id: string; status: string; message: string; fix?: string }
}

describe('built-in checks — golden path', () => {
  it('all green on a well-formed scaffold', async () => {
    writeFile('package.json', JSON.stringify({
      name: 'demo', engines: { node: '>=20.0.0' },
      dependencies: { '@rudderjs/cli': '*' },
    }))
    writeFile('pnpm-lock.yaml', '')
    writeFile('.env', 'APP_KEY=' + Buffer.alloc(32, 0xab).toString('base64') + '\nAPP_ENV=local\n')
    writeFile('bootstrap/app.ts',       'Application.configure({}).create()')
    writeFile('bootstrap/providers.ts', 'export default []')
    writeFile('routes/web.ts',          'export default () => {}')
    writeFile('app/Views/Welcome.tsx',  'export default () => null')
    // node_modules entries the checks resolve against
    writeFile('node_modules/@rudderjs/cli/package.json',
      JSON.stringify({ name: '@rudderjs/cli', version: '0.0.0' }))
    writeFile('bootstrap/cache/providers.json', '{}')
    // Manifest mtime must be >= package.json mtime
    const pkgPath = path.join(tmpDir, 'package.json')
    const manifestPath = path.join(tmpDir, 'bootstrap/cache/providers.json')
    const future = (fs.statSync(pkgPath).mtimeMs + 1000) / 1000
    fs.utimesSync(manifestPath, future, future)

    process.env['APP_KEY'] = Buffer.alloc(32, 0xab).toString('base64')
    process.env['APP_ENV'] = 'local'

    const result = await runChecks()
    assert.strictEqual(result.counts.error, 0,
      `expected no errors, got: ${result.outcomes.filter(o => o.status === 'error').map(o => `${o.id}: ${o.message}`).join(', ')}`)
  })
})

describe('built-in checks — broken state', () => {
  it('env:dotenv-loadable fails when .env is missing', async () => {
    writeFile('package.json', '{}')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:dotenv-loadable')
    assert.strictEqual(o.status, 'error')
    assert.ok(o.message.includes('missing'))
  })

  it('env:app-key fails when unset', async () => {
    writeFile('package.json', '{}')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:app-key')
    assert.strictEqual(o.status, 'error')
    assert.ok(o.fix)
  })

  it('env:app-key warns when too short', async () => {
    writeFile('package.json', '{}')
    process.env['APP_KEY'] = 'short'
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:app-key')
    assert.strictEqual(o.status, 'warn')
    assert.ok(o.message.includes('bytes'))
  })

  it('env:package-manager errors on no lockfile', async () => {
    writeFile('package.json', '{}')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:package-manager')
    assert.strictEqual(o.status, 'error')
  })

  it('env:package-manager warns on multiple lockfiles', async () => {
    writeFile('package.json', '{}')
    writeFile('pnpm-lock.yaml',    '')
    writeFile('package-lock.json', '')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:package-manager')
    assert.strictEqual(o.status, 'warn')
    assert.ok(o.message.includes('multiple lockfiles'))
  })

  it('structure:bootstrap-app errors when file missing', async () => {
    writeFile('package.json', '{}')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'structure:bootstrap-app')
    assert.strictEqual(o.status, 'error')
  })

  it('structure:bootstrap-providers warns when default export missing', async () => {
    writeFile('package.json', '{}')
    writeFile('bootstrap/providers.ts', 'const x = []\n')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'structure:bootstrap-providers')
    assert.strictEqual(o.status, 'warn')
  })

  it('structure:routes errors when no routes/* exists', async () => {
    writeFile('package.json', '{}')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'structure:routes')
    assert.strictEqual(o.status, 'error')
  })

  it('deps:providers-manifest warns when missing', async () => {
    writeFile('package.json', '{}')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'deps:providers-manifest')
    assert.strictEqual(o.status, 'warn')
    assert.ok(o.fix?.includes('providers:discover'))
  })

  it('deps:declared-installed errors when declared @rudderjs/* not in node_modules', async () => {
    writeFile('package.json', JSON.stringify({
      name: 'demo',
      dependencies: { '@rudderjs/cli': '*', '@rudderjs/ghost': '*' },
    }))
    // Only one of the two is installed
    writeFile('node_modules/@rudderjs/cli/package.json',
      JSON.stringify({ name: '@rudderjs/cli', version: '0.0.0' }))
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'deps:declared-installed')
    assert.strictEqual(o.status, 'error')
    assert.ok(o.message.includes('@rudderjs/ghost'))
  })
})

describe('built-in checks — monorepo friendliness', () => {
  it('env:package-manager finds lockfile at workspace root', async () => {
    // Workspace root has the lockfile + pnpm-workspace.yaml; package lives in a subdir.
    fs.mkdirSync(path.join(tmpDir, 'packages/app'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'),      '')
    fs.writeFileSync(path.join(tmpDir, 'packages/app/package.json'), '{}')
    process.chdir(path.join(tmpDir, 'packages/app'))

    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:package-manager')
    assert.strictEqual(o.status, 'ok', `expected ok, got ${o.status}: ${o.message}`)
    assert.ok(o.message.includes('workspace root'), `expected workspace-root hint, got: ${o.message}`)
  })

  it('deps:providers-manifest ok on manual composition (no defaultProviders call)', async () => {
    writeFile('package.json', '{}')
    // Manual composition — no `defaultProviders()` call, no manifest needed.
    writeFile('bootstrap/providers.ts',
      "import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'\nexport default [AppServiceProvider]\n")
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'deps:providers-manifest')
    assert.strictEqual(o.status, 'ok')
    assert.ok(o.message.includes('manual composition'))
  })

  it('deps:providers-manifest still warns when defaultProviders is used and manifest missing', async () => {
    writeFile('package.json', '{}')
    // Standard scaffolded shape — needs manifest.
    writeFile('bootstrap/providers.ts',
      'export default [...(await defaultProviders())]\n')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'deps:providers-manifest')
    assert.strictEqual(o.status, 'warn')
    assert.ok(o.fix?.includes('providers:discover'))
  })

  it('env:app-key warns (not errors) when no session/auth providers in use', async () => {
    writeFile('package.json', '{}')
    // Manual composition with no session/auth references — APP_KEY isn't consumed.
    writeFile('bootstrap/providers.ts',
      "import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'\nexport default [AppServiceProvider]\n")
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:app-key')
    assert.strictEqual(o.status, 'warn')
    assert.ok(o.message.includes('no session/auth'))
  })

  it('env:app-key still errors when defaultProviders is used', async () => {
    writeFile('package.json', '{}')
    writeFile('bootstrap/providers.ts',
      'export default [...(await defaultProviders())]\n')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:app-key')
    assert.strictEqual(o.status, 'error')
  })

  it('env:app-key still errors when SessionProvider is manually composed', async () => {
    writeFile('package.json', '{}')
    writeFile('bootstrap/providers.ts',
      "import { SessionProvider } from '@rudderjs/session'\nexport default [SessionProvider]\n")
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:app-key')
    assert.strictEqual(o.status, 'error')
  })

  it('env:dotenv-loadable passes when APP_KEY supplied via process.env', async () => {
    // Docker / CI / Forge / Fly / Kubernetes shape — operator sets config in
    // the host env, no .env file on disk. The other env checks still
    // validate the per-key concerns (APP_KEY length, APP_ENV value, etc.).
    writeFile('package.json', '{}')
    process.env['APP_KEY'] = Buffer.alloc(32, 0xab).toString('base64')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:dotenv-loadable')
    assert.strictEqual(o.status, 'ok', `expected ok, got ${o.status}: ${o.message}`)
    assert.ok(o.message.includes('process.env'), `expected process.env hint, got: ${o.message}`)
    assert.ok(o.message.includes('APP_KEY'), `expected APP_KEY in message, got: ${o.message}`)
  })

  it('env:dotenv-loadable passes when only DATABASE_URL is supplied via process.env', async () => {
    // API-only / no-session app in CI — APP_KEY isn't needed (env:app-key
    // warns) but DATABASE_URL signals the operator chose the process.env
    // shape deliberately.
    writeFile('package.json', '{}')
    process.env['DATABASE_URL'] = 'postgresql://localhost/test'
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:dotenv-loadable')
    assert.strictEqual(o.status, 'ok')
    assert.ok(o.message.includes('DATABASE_URL'))
  })

  it('env:dotenv-loadable passes when only APP_ENV is supplied via process.env', async () => {
    writeFile('package.json', '{}')
    process.env['APP_ENV'] = 'production'
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:dotenv-loadable')
    assert.strictEqual(o.status, 'ok')
    assert.ok(o.message.includes('APP_ENV'))
  })

  it('env:dotenv-loadable still errors on a bare fresh clone (no .env, no env signals)', async () => {
    // Regression guard: removing the file check entirely would mask the
    // "you forgot to copy .env.example" beginner case. With no .env and
    // none of the framework-cared-about keys in process.env, the check
    // must still fire.
    writeFile('package.json', '{}')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:dotenv-loadable')
    assert.strictEqual(o.status, 'error')
    assert.ok(o.message.includes('missing'))
  })

  it('env:dotenv-loadable still validates the .env file when present', async () => {
    // File-shape branch is unchanged regardless of process.env state.
    writeFile('package.json', '{}')
    writeFile('.env', 'APP_KEY=abc\nFOO=bar\n')
    process.env['APP_KEY'] = 'in-env-too'  // should be ignored on this branch
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'env:dotenv-loadable')
    assert.strictEqual(o.status, 'ok')
    assert.ok(o.message.includes('parses'))
  })
})
