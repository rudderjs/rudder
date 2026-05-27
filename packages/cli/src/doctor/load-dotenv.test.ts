import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { loadDotenvForChecks } from './load-dotenv.js'

describe('loadDotenvForChecks()', () => {
  let tmpDir: string
  const touched: string[] = []

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rudder-dotenv-test-'))
  })
  afterEach(() => {
    for (const k of touched.splice(0)) delete process.env[k]
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('loads vars defined in .env into process.env', () => {
    fs.writeFileSync(path.join(tmpDir, '.env'), 'RUDDER_TEST_AUTH=abc123\nRUDDER_TEST_DB="file:./dev.db"\n')
    touched.push('RUDDER_TEST_AUTH', 'RUDDER_TEST_DB')
    assert.equal(process.env['RUDDER_TEST_AUTH'], undefined)

    loadDotenvForChecks(tmpDir)

    assert.equal(process.env['RUDDER_TEST_AUTH'], 'abc123')
    assert.equal(process.env['RUDDER_TEST_DB'], 'file:./dev.db')
  })

  it('does NOT override a var already set in process.env (real exported env wins)', () => {
    touched.push('RUDDER_TEST_AUTH')
    process.env['RUDDER_TEST_AUTH'] = 'from-shell'
    fs.writeFileSync(path.join(tmpDir, '.env'), 'RUDDER_TEST_AUTH=from-dotenv\n')

    loadDotenvForChecks(tmpDir)

    assert.equal(process.env['RUDDER_TEST_AUTH'], 'from-shell')
  })

  it('is a no-op when no .env file is present', () => {
    // tmpDir has no .env — must not throw
    assert.doesNotThrow(() => loadDotenvForChecks(tmpDir))
  })
})
