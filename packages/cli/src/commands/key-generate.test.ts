import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { _internal } from './key-generate.js'

const { generateKey, setEnvKey } = _internal

// ── generateKey ───────────────────────────────────────────────

describe('key:generate — generateKey', () => {
  it('emits a base64:-prefixed 32-byte key', () => {
    const k = generateKey()
    assert.match(k, /^base64:[A-Za-z0-9+/]+=*$/)
    const decoded = Buffer.from(k.slice('base64:'.length), 'base64')
    assert.equal(decoded.length, 32)
  })

  it('produces a distinct key each call', () => {
    const a = generateKey()
    const b = generateKey()
    assert.notEqual(a, b)
  })
})

// ── setEnvKey ─────────────────────────────────────────────────

describe('key:generate — setEnvKey', () => {
  let tmp:     string
  let envPath: string

  beforeEach(async () => {
    tmp     = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-key-'))
    envPath = path.join(tmp, '.env')
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('wrote-new: creates .env when it does not exist', () => {
    const result = setEnvKey(envPath, 'base64:test', false)
    assert.equal(result.kind, 'wrote-new')
    assert.equal(readFileSync(envPath, 'utf8'), 'APP_KEY=base64:test\n')
  })

  it('appended: adds APP_KEY when .env exists without it', async () => {
    await fs.writeFile(envPath, 'APP_ENV=local\nDATABASE_URL=file:./dev.db\n')
    const result = setEnvKey(envPath, 'base64:test', false)
    assert.equal(result.kind, 'appended')
    const out = readFileSync(envPath, 'utf8')
    assert.match(out, /APP_ENV=local/)
    assert.match(out, /DATABASE_URL=file:\.\/dev\.db/)
    assert.match(out, /APP_KEY=base64:test$/m)
  })

  it('appended: handles .env that does not end with newline', async () => {
    await fs.writeFile(envPath, 'APP_ENV=local')   // no trailing newline
    setEnvKey(envPath, 'base64:test', false)
    const out = readFileSync(envPath, 'utf8')
    assert.equal(out, 'APP_ENV=local\nAPP_KEY=base64:test\n')
  })

  it('replaced: overwrites an existing APP_KEY when value is empty (even without --force)', async () => {
    await fs.writeFile(envPath, 'APP_KEY=\nAPP_ENV=local\n')
    const result = setEnvKey(envPath, 'base64:test', false)
    assert.equal(result.kind, 'replaced')
    const out = readFileSync(envPath, 'utf8')
    assert.equal(out, 'APP_KEY=base64:test\nAPP_ENV=local\n')
  })

  it('replaced: overwrites empty quoted APP_KEY', async () => {
    await fs.writeFile(envPath, 'APP_KEY=""\n')
    setEnvKey(envPath, 'base64:test', false)
    assert.equal(readFileSync(envPath, 'utf8'), 'APP_KEY=base64:test\n')
  })

  it('skipped: refuses to overwrite a non-empty APP_KEY without --force', async () => {
    await fs.writeFile(envPath, 'APP_KEY=base64:existing\n')
    const result = setEnvKey(envPath, 'base64:new', false)
    assert.equal(result.kind, 'skipped')
    // File untouched
    assert.equal(readFileSync(envPath, 'utf8'), 'APP_KEY=base64:existing\n')
  })

  it('replaced: --force overwrites a non-empty APP_KEY', async () => {
    await fs.writeFile(envPath, 'APP_KEY=base64:existing\nAPP_ENV=local\n')
    const result = setEnvKey(envPath, 'base64:new', true)
    assert.equal(result.kind, 'replaced')
    const out = readFileSync(envPath, 'utf8')
    assert.equal(out, 'APP_KEY=base64:new\nAPP_ENV=local\n')
  })

  it('does NOT touch a commented-out APP_KEY line', async () => {
    await fs.writeFile(envPath, '# APP_KEY=should-be-ignored\nAPP_ENV=local\n')
    setEnvKey(envPath, 'base64:test', false)
    const out = readFileSync(envPath, 'utf8')
    assert.match(out, /^# APP_KEY=should-be-ignored$/m)
    assert.match(out, /^APP_KEY=base64:test$/m)
  })

  it('does NOT match APP_KEY-prefixed names like APP_KEYS', async () => {
    await fs.writeFile(envPath, 'APP_KEYS=foo,bar\n')
    const result = setEnvKey(envPath, 'base64:test', false)
    assert.equal(result.kind, 'appended')
    const out = readFileSync(envPath, 'utf8')
    assert.match(out, /^APP_KEYS=foo,bar$/m)
    assert.match(out, /^APP_KEY=base64:test$/m)
  })

  it('preserves comments and blank lines around the APP_KEY entry', async () => {
    const before = '# App config\nAPP_ENV=local\n\n# Encryption\nAPP_KEY=\n\n# Database\nDATABASE_URL=file:./dev.db\n'
    await fs.writeFile(envPath, before)
    setEnvKey(envPath, 'base64:test', false)
    const after = readFileSync(envPath, 'utf8')
    assert.equal(after, '# App config\nAPP_ENV=local\n\n# Encryption\nAPP_KEY=base64:test\n\n# Database\nDATABASE_URL=file:./dev.db\n')
  })
})
