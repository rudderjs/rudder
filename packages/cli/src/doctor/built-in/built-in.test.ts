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
    writeFile('bootstrap/app.ts',       "import 'reflect-metadata'\nApplication.configure({}).create()")
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

  it('structure:rudder-types-tsconfig is ok when no .rudder/ exists', async () => {
    writeFile('package.json', '{}')
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'structure:rudder-types-tsconfig')
    assert.strictEqual(o.status, 'ok')
  })

  it('structure:rudder-types-tsconfig warns when .rudder/ exists but include misses it', async () => {
    writeFile('package.json', '{}')
    writeFile('.rudder/types/views.d.ts', 'export {}\n')
    writeFile('tsconfig.json', JSON.stringify({ include: ['app/**/*'] }))
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'structure:rudder-types-tsconfig')
    assert.strictEqual(o.status, 'warn')
    assert.ok(o.fix?.includes('.rudder/**/*'))
  })

  it('structure:rudder-types-tsconfig warns on the bare ".rudder" include form', async () => {
    writeFile('package.json', '{}')
    writeFile('.rudder/types/views.d.ts', 'export {}\n')
    writeFile('tsconfig.json', JSON.stringify({ include: ['.rudder', 'app/**/*'] }))
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'structure:rudder-types-tsconfig')
    assert.strictEqual(o.status, 'warn')
    assert.ok(o.message.includes('bare'))
  })

  it('structure:rudder-types-tsconfig is ok with the glob include form', async () => {
    writeFile('package.json', '{}')
    writeFile('.rudder/types/views.d.ts', 'export {}\n')
    writeFile('tsconfig.json', JSON.stringify({ include: ['.rudder/**/*', 'app/**/*'] }))
    const result = await runChecks()
    const o = outcomeFor(result.outcomes, 'structure:rudder-types-tsconfig')
    assert.strictEqual(o.status, 'ok')
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

// ─── deps:version-skew ───────────────────────────────────────────────────────
//
// Skewed sibling installs (exact pnpm.overrides pins below a sibling's
// declared floor) fail at runtime as a bare ESM link error. The check reads
// each installed @rudderjs package's declared sibling ranges and verifies
// them against what actually resolves from that package's location.

function writeInstalledPkg(name: string, version: string, extra: Record<string, unknown> = {}): void {
  writeFile(path.join('node_modules', name, 'package.json'), JSON.stringify({ name, version, ...extra }))
}

describe('deps:version-skew', () => {
  it('ok when no @rudderjs packages are installed', async () => {
    writeFile('package.json', JSON.stringify({ name: 'demo' }))
    const o = outcomeFor((await runChecks({})).outcomes, 'deps:version-skew')
    assert.equal(o.status, 'ok')
  })

  it('flags a sibling pinned below a declared floor, naming both versions', async () => {
    // The 2026-06-09 field case: session@2.3.0 needs contracts ^1.16.0,
    // app's pnpm.overrides pinned contracts to 1.15.2.
    writeInstalledPkg('@rudderjs/session', '2.3.0', {
      dependencies: { '@rudderjs/contracts': '^1.16.0' },
    })
    writeInstalledPkg('@rudderjs/contracts', '1.15.2')
    const o = outcomeFor((await runChecks({})).outcomes, 'deps:version-skew')
    assert.equal(o.status, 'error')
    assert.ok(o.message.includes('@rudderjs/session@2.3.0 requires @rudderjs/contracts ^1.16.0'))
    assert.ok(o.message.includes('found 1.15.2'))
    assert.ok(o.fix?.includes('overrides'))
  })

  it('ok when every sibling range is satisfied', async () => {
    writeInstalledPkg('@rudderjs/session', '2.3.0', {
      dependencies:     { '@rudderjs/contracts': '^1.16.0' },
      peerDependencies: { '@rudderjs/core': '>=1.11.0' },
    })
    writeInstalledPkg('@rudderjs/contracts', '1.16.2')
    writeInstalledPkg('@rudderjs/core', '1.12.1')
    const o = outcomeFor((await runChecks({})).outcomes, 'deps:version-skew')
    assert.equal(o.status, 'ok')
    assert.ok(o.message.includes('2 sibling ranges satisfied'))
  })

  it('caret does not cross majors — peer on ^1 with 2.x installed is a violation', async () => {
    writeInstalledPkg('@rudderjs/auth', '6.5.0', {
      peerDependencies: { '@rudderjs/session': '^1.0.0' },
    })
    writeInstalledPkg('@rudderjs/session', '2.3.0')
    const o = outcomeFor((await runChecks({})).outcomes, 'deps:version-skew')
    assert.equal(o.status, 'error')
  })

  it('absent optional peers and workspace: ranges are skipped, unparseable ranges fail open', async () => {
    writeInstalledPkg('@rudderjs/session', '2.3.0', {
      peerDependencies:     { '@rudderjs/vite': '^2.0.0', '@rudderjs/contracts': 'workspace:^', '@rudderjs/core': 'beta-weird' },
      peerDependenciesMeta: { '@rudderjs/vite': { optional: true } },
    })
    writeInstalledPkg('@rudderjs/core', '1.12.1') // 'beta-weird' is unreadable — must not fire
    const o = outcomeFor((await runChecks({})).outcomes, 'deps:version-skew')
    assert.equal(o.status, 'ok')
  })

  it('resolves a package-nested sibling copy ahead of the top level (npm nesting / pnpm store)', async () => {
    // session carries its OWN nested contracts@1.16.0 (satisfying) while the
    // top level holds 1.15.2 — what session loads is fine, so no violation.
    writeInstalledPkg('@rudderjs/session', '2.3.0', {
      dependencies: { '@rudderjs/contracts': '^1.16.0' },
    })
    writeFile(path.join('node_modules', '@rudderjs/session', 'node_modules', '@rudderjs/contracts', 'package.json'),
      JSON.stringify({ name: '@rudderjs/contracts', version: '1.16.0' }))
    writeInstalledPkg('@rudderjs/contracts', '1.15.2')
    const o = outcomeFor((await runChecks({})).outcomes, 'deps:version-skew')
    assert.equal(o.status, 'ok')
  })
})

describe('structure:reflect-metadata', () => {
  it('errors when bootstrap/app.ts does not import reflect-metadata', async () => {
    writeFile('package.json', '{}')
    writeFile('bootstrap/app.ts', 'Application.configure({}).create()')
    const o = outcomeFor((await runChecks()).outcomes, 'structure:reflect-metadata')
    assert.strictEqual(o.status, 'error')
    assert.ok(o.fix)
  })

  it('passes when the import is present', async () => {
    writeFile('package.json', '{}')
    writeFile('bootstrap/app.ts', "import 'reflect-metadata'\nApplication.configure({}).create()")
    const o = outcomeFor((await runChecks()).outcomes, 'structure:reflect-metadata')
    assert.strictEqual(o.status, 'ok')
  })

  it('skips (ok) when there is no bootstrap/app.ts', async () => {
    writeFile('package.json', '{}')
    const o = outcomeFor((await runChecks()).outcomes, 'structure:reflect-metadata')
    assert.strictEqual(o.status, 'ok')
  })
})

describe('structure:tsconfig-decorators', () => {
  it('passes when both flags are set directly', async () => {
    writeFile('package.json', '{}')
    writeFile('tsconfig.json', JSON.stringify({
      compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
    }))
    const o = outcomeFor((await runChecks()).outcomes, 'structure:tsconfig-decorators')
    assert.strictEqual(o.status, 'ok')
  })

  it('resolves flags inherited from an extended base (and tolerates JSONC comments)', async () => {
    writeFile('package.json', '{}')
    writeFile('tsconfig.base.json', JSON.stringify({
      compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
    }))
    writeFile('tsconfig.json', '{\n  // app config\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": { "strict": true },\n}')
    const o = outcomeFor((await runChecks()).outcomes, 'structure:tsconfig-decorators')
    assert.strictEqual(o.status, 'ok')
  })

  it('errors when the flags are missing across a fully-resolved chain', async () => {
    writeFile('package.json', '{}')
    writeFile('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }))
    const o = outcomeFor((await runChecks()).outcomes, 'structure:tsconfig-decorators')
    assert.strictEqual(o.status, 'error')
    assert.ok(o.message.includes('experimentalDecorators'))
  })

  it('warns (does not hard-error) when an extended tsconfig is unreadable', async () => {
    writeFile('package.json', '{}')
    writeFile('tsconfig.json', JSON.stringify({ extends: './missing-base.json', compilerOptions: {} }))
    const o = outcomeFor((await runChecks()).outcomes, 'structure:tsconfig-decorators')
    assert.strictEqual(o.status, 'warn')
  })

  it('skips (ok) when there is no tsconfig.json', async () => {
    writeFile('package.json', '{}')
    const o = outcomeFor((await runChecks()).outcomes, 'structure:tsconfig-decorators')
    assert.strictEqual(o.status, 'ok')
  })
})

describe('deps:single-orm-driver', () => {
  it('ok with a single adapter', async () => {
    writeFile('package.json', JSON.stringify({ dependencies: { '@rudderjs/orm-prisma': '*' } }))
    const o = outcomeFor((await runChecks()).outcomes, 'deps:single-orm-driver')
    assert.strictEqual(o.status, 'ok')
  })

  it('ok on the native engine (no orm-* adapter)', async () => {
    writeFile('package.json', JSON.stringify({ dependencies: { '@rudderjs/orm': '*', '@rudderjs/database': '*' } }))
    const o = outcomeFor((await runChecks()).outcomes, 'deps:single-orm-driver')
    assert.strictEqual(o.status, 'ok')
  })

  it('warns when two adapters are installed', async () => {
    writeFile('package.json', JSON.stringify({
      dependencies: { '@rudderjs/orm-prisma': '*' }, devDependencies: { '@rudderjs/orm-drizzle': '*' },
    }))
    const o = outcomeFor((await runChecks()).outcomes, 'deps:single-orm-driver')
    assert.strictEqual(o.status, 'warn')
    assert.ok(o.fix && o.fix.includes('DB_DRIVER'))
  })
})

describe('deps:single-vike-renderer', () => {
  it('ok with one renderer', async () => {
    writeFile('package.json', JSON.stringify({ dependencies: { 'vike-react': '*' } }))
    const o = outcomeFor((await runChecks()).outcomes, 'deps:single-vike-renderer')
    assert.strictEqual(o.status, 'ok')
  })

  it('ok with none (vanilla)', async () => {
    writeFile('package.json', '{}')
    const o = outcomeFor((await runChecks()).outcomes, 'deps:single-vike-renderer')
    assert.strictEqual(o.status, 'ok')
  })

  it('errors with two renderers and names them in the fix', async () => {
    writeFile('package.json', JSON.stringify({ dependencies: { 'vike-react': '*', 'vike-vue': '*' } }))
    const o = outcomeFor((await runChecks()).outcomes, 'deps:single-vike-renderer')
    assert.strictEqual(o.status, 'error')
    assert.ok(o.fix && o.fix.includes('pnpm remove'))
  })
})
