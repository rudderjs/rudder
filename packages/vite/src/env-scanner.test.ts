import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parseEnvKeys, envRegistrySource, syncEnvFromDisk, envScannerPlugin } from './env-scanner.js'

function scaffold(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'env-scanner-'))
}

function write(root: string, rel: string, contents: string): void {
  const file = path.join(root, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, contents)
}

describe('env-scanner — parseEnvKeys', () => {
  it('parses plain KEY=value lines', () => {
    const keys = parseEnvKeys('APP_NAME=demo\nPORT=3000\n')
    assert.deepEqual(keys.map(k => k.key), ['APP_NAME', 'PORT'])
  })

  it('keeps the full line for --fix usage', () => {
    const keys = parseEnvKeys('DATABASE_URL="file:./dev.db"\n')
    assert.equal(keys[0]?.line, 'DATABASE_URL="file:./dev.db"')
  })

  it('accepts export-prefixed and empty-value lines', () => {
    const keys = parseEnvKeys('export NODE_OPTIONS=--inspect\nANTHROPIC_API_KEY=\n')
    assert.deepEqual(keys.map(k => k.key), ['NODE_OPTIONS', 'ANTHROPIC_API_KEY'])
  })

  it('skips comments — including commented-out example keys', () => {
    const keys = parseEnvKeys('# a comment\n# OPENAI_API_KEY=\nAPP_ENV=development\n')
    assert.deepEqual(keys.map(k => k.key), ['APP_ENV'])
  })

  it('skips malformed lines and dedups (first-write-wins)', () => {
    const keys = parseEnvKeys('not a kv line\n1BAD=x\nPORT=3000\nPORT=4000\n')
    assert.deepEqual(keys.map(k => k.key), ['PORT'])
    assert.equal(keys[0]?.line, 'PORT=3000')
  })

  it('tolerates CRLF and indentation', () => {
    const keys = parseEnvKeys('  APP_NAME=demo\r\nPORT=3000\r\n')
    assert.deepEqual(keys.map(k => k.key), ['APP_NAME', 'PORT'])
  })
})

describe('env-scanner — envRegistrySource', () => {
  it('emits one string entry per key in an EnvRegistry augmentation', () => {
    const src = envRegistrySource(parseEnvKeys('APP_NAME=x\nPORT=3000\n'))
    assert.match(src, /declare module '@rudderjs\/support'/)
    assert.match(src, /interface EnvRegistry/)
    assert.match(src, /'APP_NAME': string/)
    assert.match(src, /'PORT': string/)
  })

  it('emits an empty interface when no keys are declared', () => {
    const src = envRegistrySource([])
    assert.match(src, /interface EnvRegistry \{\s*\}/)
  })
})

describe('env-scanner — syncEnvFromDisk', () => {
  let root = ''
  const prevCwd = process.cwd()

  afterEach(() => {
    process.chdir(prevCwd)
    if (root) fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('writes .rudder/types/env.d.ts from .env.example', () => {
    root = scaffold()
    write(root, '.env.example', 'APP_NAME=demo\nPORT=3000\n')
    const result = syncEnvFromDisk(root)
    assert.equal(result.exampleExists, true)
    assert.equal(result.keyCount, 2)
    const out = fs.readFileSync(path.join(root, '.rudder', 'types', 'env.d.ts'), 'utf8')
    assert.match(out, /'APP_NAME': string/)
  })

  it('writes the .rudder/README.md alongside', () => {
    root = scaffold()
    write(root, '.env.example', 'APP_NAME=demo\n')
    syncEnvFromDisk(root)
    const readme = fs.readFileSync(path.join(root, '.rudder', 'README.md'), 'utf8')
    assert.match(readme, /types\/env\.d\.ts/)
  })

  it('removes a stale emit when .env.example is gone', () => {
    root = scaffold()
    write(root, '.env.example', 'APP_NAME=demo\n')
    syncEnvFromDisk(root)
    fs.rmSync(path.join(root, '.env.example'))
    const result = syncEnvFromDisk(root)
    assert.equal(result.exampleExists, false)
    assert.equal(fs.existsSync(path.join(root, '.rudder', 'types', 'env.d.ts')), false)
  })

  it('never reads .env — keys only there stay undeclared', () => {
    root = scaffold()
    write(root, '.env.example', 'APP_NAME=demo\n')
    write(root, '.env', 'APP_NAME=real\nSECRET_ONLY_HERE=shh\n')
    syncEnvFromDisk(root)
    const out = fs.readFileSync(path.join(root, '.rudder', 'types', 'env.d.ts'), 'utf8')
    assert.doesNotMatch(out, /SECRET_ONLY_HERE/)
  })
})

describe('env-scanner — plugin', () => {
  let root = ''
  const prevCwd = process.cwd()

  afterEach(() => {
    process.chdir(prevCwd)
    if (root) fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  it('eager-syncs at construction time', () => {
    root = scaffold()
    write(root, '.env.example', 'EAGER_KEY=1\n')
    process.chdir(root)
    envScannerPlugin()
    const out = fs.readFileSync(path.join(root, '.rudder', 'types', 'env.d.ts'), 'utf8')
    assert.match(out, /'EAGER_KEY': string/)
  })

  it('is a no-op without .env.example (no .rudder noise)', () => {
    root = scaffold()
    process.chdir(root)
    envScannerPlugin()
    assert.equal(fs.existsSync(path.join(root, '.rudder')), false)
  })
})
