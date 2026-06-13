// Provider-manifest ROUND-TRIP: scanProviders() → writeProviderManifest() →
// defaultProviders() against one real on-disk fixture. The writer
// (commands/providers-discover.ts) and the reader (default-providers.ts) are
// otherwise only tested in isolation, so a format drift between them — a
// renamed field, a version bump, a providerSubpath that scans but doesn't
// load — would surface only at app boot. The fixture deliberately includes a
// `providerSubpath` entry (no other test manifest has one; `@rudderjs/ai` and
// orm-native rely on it in production) whose MAIN entry does NOT export the
// provider class, proving the subpath is what actually loads.

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { scanProviders, writeProviderManifest } from './commands/providers-discover.js'
import { defaultProviders, getLastLoadedProviderEntries } from './default-providers.js'

const SCRATCH = path.join(process.cwd(), '.test-scratch-manifest-roundtrip')
const ORIGINAL_CWD = process.cwd()

function writePkg(dir: string, pkgJson: Record<string, unknown>, files: Record<string, string> = {}): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson, null, 2))
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), contents)
  }
}

describe('provider manifest round-trip (scan → write → load)', () => {
  before(() => {
    const scope = path.join(SCRATCH, 'node_modules', '@rudderjs')

    // A plain main-entry provider (the common shape).
    writePkg(path.join(scope, 'fake-main'), {
      name: '@rudderjs/fake-main',
      type: 'module',
      main: './index.js',
      rudderjs: { provider: 'FakeMainProvider', stage: 'feature' },
    }, {
      'index.js': 'export class FakeMainProvider {}\n',
    })

    // A providerSubpath provider (the @rudderjs/ai / orm-native shape): the
    // class lives at ./server, and the main entry deliberately does NOT export
    // it — loading via the main entry would throw, so a passing round-trip
    // proves the subpath survived scan → manifest → import.
    writePkg(path.join(scope, 'fake-sub'), {
      name: '@rudderjs/fake-sub',
      type: 'module',
      exports: { '.': './index.js', './server': './server.js' },
      rudderjs: { provider: 'FakeSubProvider', stage: 'infrastructure', providerSubpath: './server' },
    }, {
      'index.js': "export const runtimeAgnosticEntry = true\n",
      'server.js': 'export class FakeSubProvider {}\n',
    })

    // Opted out of discovery — must not reach the manifest at all.
    writePkg(path.join(scope, 'fake-optout'), {
      name: '@rudderjs/fake-optout',
      type: 'module',
      main: './index.js',
      rudderjs: { provider: 'NopeProvider', stage: 'feature', autoDiscover: false },
    }, {
      'index.js': 'export class NopeProvider {}\n',
    })

    // No rudderjs field — must be ignored by the scan.
    writePkg(path.join(scope, 'plain-lib'), {
      name: '@rudderjs/plain-lib',
      type: 'module',
      main: './index.js',
    }, {
      'index.js': 'export const notAProvider = true\n',
    })

    // A rudderjs field with NO `provider` key — must be skipped with a warning,
    // not written to the manifest (a provider-less entry hard-throws at load).
    writePkg(path.join(scope, 'fake-no-provider'), {
      name: '@rudderjs/fake-no-provider',
      type: 'module',
      main: './index.js',
      rudderjs: { stage: 'feature' },
    }, {
      'index.js': 'export class SomethingElse {}\n',
    })
  })

  after(() => {
    process.chdir(ORIGINAL_CWD)
    if (existsSync(SCRATCH)) rmSync(SCRATCH, { recursive: true, force: true })
  })

  it('scan → write → defaultProviders loads the same providers, subpath included', async () => {
    // ── Scan ──
    const entries = scanProviders(SCRATCH)
    const names = entries.map(e => e.package)
    assert.deepStrictEqual(
      names,
      ['@rudderjs/fake-sub', '@rudderjs/fake-main'],
      'scan finds both providers in stage order (infrastructure → feature), excluding opt-outs, field-less packages, and rudderjs-fields with no provider',
    )
    assert.strictEqual(
      entries.find(e => e.package === '@rudderjs/fake-no-provider'),
      undefined,
      'a rudderjs field with no provider is skipped, not scanned',
    )
    const sub = entries.find(e => e.package === '@rudderjs/fake-sub')
    assert.strictEqual(sub?.providerSubpath, './server', 'providerSubpath must survive the scan')

    // ── Write ──
    const manifestPath = writeProviderManifest(SCRATCH, entries)
    assert.strictEqual(manifestPath, path.join(SCRATCH, 'bootstrap/cache', 'providers.json'))
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      version: number
      fingerprint?: { depsHash?: string }
      providers: Array<{ package: string; providerSubpath?: string }>
    }
    assert.strictEqual(manifest.version, 3, 'reader expects manifest version 3')
    assert.ok(manifest.fingerprint, 'v3 manifests carry a fingerprint for boot-time staleness checks')
    assert.strictEqual(
      manifest.providers.find(p => p.package === '@rudderjs/fake-sub')?.providerSubpath,
      './server',
      'providerSubpath must survive serialization',
    )

    // ── Load ──
    // defaultProviders() reads bootstrap/cache/providers.json from process.cwd()
    // and resolves each package from that cwd's node_modules.
    process.chdir(SCRATCH)
    try {
      const providers = await defaultProviders()
      assert.deepStrictEqual(
        providers.map(p => p.name),
        ['FakeSubProvider', 'FakeMainProvider'],
        'both classes load, in manifest order — the subpath class via ./server, not the main entry',
      )
      const loaded = getLastLoadedProviderEntries()
      assert.deepStrictEqual(loaded.map(e => e.package), ['@rudderjs/fake-sub', '@rudderjs/fake-main'])
    } finally {
      process.chdir(ORIGINAL_CWD)
    }
  })
})
