// loadPackageChecks() walk: imports `<cwd>/node_modules/<pkg>/dist/doctor.js`
// for every package in PACKAGES_WITH_CHECKS, silently skipping missing and
// BROKEN modules. The walk itself was previously untested — the same untested
// walk shape in loadPackageCommands once hid the "every package make:* was a
// no-op in dev" bug — so this pins it against a real on-disk fixture.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resetDoctorRegistry, getRegisteredChecks } from '@rudderjs/console'

import { loadPackageChecks } from './load-package-checks.js'

const prevCwd = process.cwd()
let root = ''

// The fake doctor.js modules must call registerDoctorCheck against the SAME
// registry as this test. The registry is a globalThis singleton, so any
// @rudderjs/console module instance works — point the fixture import at the
// workspace's compiled console entry by absolute file URL (a bare specifier
// would not resolve from inside the scratch node_modules).
const consoleUrl = pathToFileURL(createRequire(import.meta.url).resolve('@rudderjs/console')).href

function writeDoctorModule(pkg: string, contents: string): void {
  const pkgDir = path.join(root, 'node_modules', pkg)
  fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, type: 'module' }))
  fs.writeFileSync(path.join(pkgDir, 'dist', 'doctor.js'), contents)
}

describe('loadPackageChecks — node_modules walk', () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'load-pkg-checks-'))
    resetDoctorRegistry()
    process.chdir(root)
  })

  afterEach(() => {
    process.chdir(prevCwd)
    resetDoctorRegistry()
    fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('imports each installed package\'s dist/doctor.js and registers its checks', async () => {
    writeDoctorModule('@rudderjs/orm', [
      `import { registerDoctorCheck } from '${consoleUrl}'`,
      `registerDoctorCheck({`,
      `  id: 'orm:fake-walk-check',`,
      `  category: 'orm',`,
      `  title: 'fake walk check',`,
      `  run() { return { status: 'green', message: 'ok' } }`,
      `})`,
      '',
    ].join('\n'))

    await loadPackageChecks()

    const ids = getRegisteredChecks().map(c => c.id)
    assert.ok(ids.includes('orm:fake-walk-check'), `walk must import + register; got: ${ids.join(', ') || '(none)'}`)
  })

  it('skips a BROKEN doctor module silently without killing the others', async () => {
    // @rudderjs/auth precedes @rudderjs/orm in PACKAGES_WITH_CHECKS — its
    // import-time throw must not prevent orm's checks from registering.
    writeDoctorModule('@rudderjs/auth', `throw new Error('boom at import time')\n`)
    writeDoctorModule('@rudderjs/orm', [
      `import { registerDoctorCheck } from '${consoleUrl}'`,
      `registerDoctorCheck({ id: 'orm:survives-broken-sibling', category: 'orm', title: 't', run() { return { status: 'green', message: 'ok' } } })`,
      '',
    ].join('\n'))

    await loadPackageChecks() // must not throw

    const ids = getRegisteredChecks().map(c => c.id)
    assert.ok(ids.includes('orm:survives-broken-sibling'))
    assert.equal(ids.length, 1, 'the broken module contributes nothing')
  })

  it('is a no-op when nothing is installed (no node_modules at all)', async () => {
    await loadPackageChecks() // must not throw
    assert.equal(getRegisteredChecks().length, 0)
  })
})
