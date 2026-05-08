import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { idToPath } from './resolve.js'
import { guardTTY } from './terminal.js'

describe('idToPath()', () => {
  it('single segment — capitalises the id', () => {
    assert.equal(idToPath('dashboard'), 'app/Terminal/Dashboard')
  })

  it('dot notation — nested directory + capitalised filename', () => {
    assert.equal(idToPath('admin.users'), 'app/Terminal/Admin/Users')
  })

  it('three segments', () => {
    assert.equal(idToPath('admin.auth.login'), 'app/Terminal/Admin/Auth/Login')
  })

  it('already-capitalised id passes through unchanged', () => {
    assert.equal(idToPath('Dashboard'), 'app/Terminal/Dashboard')
  })
})

describe('guardTTY()', () => {
  it('throws when isTTY is false', () => {
    assert.throws(
      () => guardTTY(false),
      (e: unknown) => e instanceof Error && /TTY/.test((e as Error).message),
    )
  })

  it('throws when isTTY is undefined', () => {
    assert.throws(
      () => guardTTY(undefined),
      (e: unknown) => e instanceof Error && /TTY/.test((e as Error).message),
    )
  })

  it('does not throw when isTTY is true', () => {
    assert.doesNotThrow(() => guardTTY(true))
  })
})
