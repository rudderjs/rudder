import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { configRegistrySource, syncConfigFromDisk, configScannerPlugin } from './config-scanner.js'

function scaffold(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'config-scanner-'))
}

function write(root: string, rel: string, contents: string): void {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

const BARREL = path.join('config', 'index.ts')

describe('config-scanner — configRegistrySource', () => {
  it('augments @rudderjs/core AppConfig from the config barrel', () => {
    const src = configRegistrySource()
    assert.match(src, /declare module '@rudderjs\/core'/)
    assert.match(src, /interface AppConfig extends RudderAppConfig/)
    assert.match(src, /import\('\.\.\/\.\.\/config\/index\.js'\)/)
  })

  it('binds the import to an alias (interface cannot extend an indexed-access type)', () => {
    const src = configRegistrySource()
    assert.match(src, /type RudderAppConfig = \(typeof import\(/)
  })
})

describe('config-scanner — syncConfigFromDisk', () => {
  let root = ''
  const prevCwd = process.cwd()

  afterEach(() => {
    process.chdir(prevCwd)
    if (root) fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('writes .rudder/types/config.d.ts when config/index.ts exists', () => {
    root = scaffold()
    write(root, BARREL, 'export default { app: { name: "x" } }\n')
    const result = syncConfigFromDisk(root)
    assert.equal(result.barrelExists, true)
    const out = fs.readFileSync(path.join(root, '.rudder', 'types', 'config.d.ts'), 'utf8')
    assert.match(out, /interface AppConfig extends RudderAppConfig/)
  })

  it('writes the .rudder/README.md alongside', () => {
    root = scaffold()
    write(root, BARREL, 'export default {}\n')
    syncConfigFromDisk(root)
    const readme = fs.readFileSync(path.join(root, '.rudder', 'README.md'), 'utf8')
    assert.match(readme, /types\/config\.d\.ts/)
  })

  it('removes a stale emit when config/index.ts is gone', () => {
    root = scaffold()
    write(root, BARREL, 'export default {}\n')
    syncConfigFromDisk(root)
    fs.rmSync(path.join(root, BARREL))
    const result = syncConfigFromDisk(root)
    assert.equal(result.barrelExists, false)
    assert.equal(fs.existsSync(path.join(root, '.rudder', 'types', 'config.d.ts')), false)
  })

  it('is idempotent — re-running does not rewrite identical content', () => {
    root = scaffold()
    write(root, BARREL, 'export default {}\n')
    syncConfigFromDisk(root)
    const out = path.join(root, '.rudder', 'types', 'config.d.ts')
    const mtime = fs.statSync(out).mtimeMs
    syncConfigFromDisk(root)
    assert.equal(fs.statSync(out).mtimeMs, mtime)
  })
})

describe('config-scanner — plugin', () => {
  let root = ''
  const prevCwd = process.cwd()

  afterEach(() => {
    process.chdir(prevCwd)
    if (root) fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('eager-syncs at construction time', () => {
    root = scaffold()
    write(root, BARREL, 'export default {}\n')
    process.chdir(root)
    configScannerPlugin()
    const out = fs.readFileSync(path.join(root, '.rudder', 'types', 'config.d.ts'), 'utf8')
    assert.match(out, /interface AppConfig/)
  })

  it('is a no-op without config/index.ts (no .rudder noise)', () => {
    root = scaffold()
    process.chdir(root)
    configScannerPlugin()
    assert.equal(fs.existsSync(path.join(root, '.rudder')), false)
  })
})
