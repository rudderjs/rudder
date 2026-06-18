import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { drainBootNotices } from '@rudderjs/core'
import {
  PasswordBroker,
  MemoryTokenRepository,
  type UserProvider,
} from './index.js'
import { resolveRememberSecret } from './remember.js'

// ─── Why this file ────────────────────────────────────────
//
// Two load-bearing production guards had zero coverage: the PasswordBroker
// constructor and resolveRememberSecret() both THROW when NODE_ENV=production
// and no secret is configured, so reset/remember tokens are never signed with
// the hardcoded dev placeholder. A regression that removed or mis-gated either
// throw would silently ship a forgeable-token build. These tests pin the throw,
// the secret-supplied happy path, and the dev fallback + one-time boot notice.
//
// Both guards use a module-private `_devSecretWarned` once-flag. node --test
// runs each test file in its own process, so the flags start fresh here; within
// the file we run the production/secret cases (which never reach the dev branch)
// BEFORE the dev case, so the one-time notice is still observable.

// The constructor/function touch neither the repo nor the users object, so
// minimal fakes are enough.
const users = {} as UserProvider
const tokens = () => new MemoryTokenRepository()

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {}
  for (const k of Object.keys(overrides)) {
    prev[k] = process.env[k]
    const v = overrides[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try { fn() } finally {
    for (const k of Object.keys(overrides)) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}

// ─── PasswordBroker secret guard ──────────────────────────

describe('PasswordBroker production secret guard', () => {
  it('throws in production when no secret is supplied', () => {
    withEnv({ NODE_ENV: 'production' }, () => {
      assert.throws(
        () => new PasswordBroker(tokens(), users, {}),
        /requires a `secret` in production/,
      )
    })
  })

  it('does not throw in production when a secret is supplied', () => {
    withEnv({ NODE_ENV: 'production' }, () => {
      assert.doesNotThrow(() => new PasswordBroker(tokens(), users, { secret: 'x'.repeat(32) }))
    })
  })

  it('falls back to a dev secret with a one-time boot notice in development', () => {
    drainBootNotices()
    withEnv({ NODE_ENV: 'development' }, () => {
      assert.doesNotThrow(() => new PasswordBroker(tokens(), users, {})) // first → notice
      assert.doesNotThrow(() => new PasswordBroker(tokens(), users, {})) // second → no extra notice
    })
    const notices = drainBootNotices().filter(n => n.scope === 'auth')
    assert.equal(notices.length, 1, `expected exactly one notice, got ${notices.length}`)
    assert.match(notices[0]!.message, /dev password secret/)
  })
})

// ─── resolveRememberSecret guard (mirrors the broker) ─────

describe('resolveRememberSecret production guard', () => {
  it('returns the explicit override when provided', () => {
    assert.equal(resolveRememberSecret('explicit-override'), 'explicit-override')
  })

  it('returns AUTH_SECRET when set', () => {
    withEnv({ AUTH_SECRET: 'env-provided-secret' }, () => {
      assert.equal(resolveRememberSecret(), 'env-provided-secret')
    })
  })

  it('throws in production when AUTH_SECRET is unset', () => {
    withEnv({ NODE_ENV: 'production', AUTH_SECRET: undefined }, () => {
      assert.throws(() => resolveRememberSecret(), /requires AUTH_SECRET in production/)
    })
  })

  it('falls back to a dev secret with a one-time boot notice in development', () => {
    drainBootNotices()
    let first: string | undefined
    withEnv({ NODE_ENV: 'development', AUTH_SECRET: undefined }, () => {
      first = resolveRememberSecret() // first → notice
      resolveRememberSecret()         // second → no extra notice
    })
    assert.equal(first, 'rudderjs-dev-remember-secret')
    const notices = drainBootNotices().filter(n => n.scope === 'auth')
    assert.equal(notices.length, 1, `expected exactly one notice, got ${notices.length}`)
    assert.match(notices[0]!.message, /dev remember-me secret/)
  })
})
