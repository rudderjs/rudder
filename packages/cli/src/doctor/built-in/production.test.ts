import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { resetDoctorRegistry, getRegisteredChecks, type DoctorCheck } from '@rudderjs/console'

// ── Helpers ──────────────────────────────────────────────────

async function loadProduction(): Promise<DoctorCheck[]> {
  resetDoctorRegistry()
  // Side-effect import — cache-busted with a query param so each test gets
  // a fresh registration (Node test reuses the same module otherwise).
  await import(`./production.js?t=${Date.now()}`)
  return getRegisteredChecks()
}

async function findCheck(id: string): Promise<DoctorCheck> {
  const all = await loadProduction()
  const c = all.find((c) => c.id === id)
  assert.ok(c, `check ${id} not registered`)
  return c
}

function setEnv(vars: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

// ── APP_DEBUG ────────────────────────────────────────────────

describe('production check — APP_DEBUG must be off', () => {
  it('errors when APP_DEBUG=true', async () => {
    const restore = setEnv({ APP_DEBUG: 'true' })
    try {
      const c = await findCheck('production:app-debug')
      const r = await c.run()
      assert.equal(r.status, 'error')
      assert.match(r.message, /APP_DEBUG=true/)
    } finally { restore() }
  })

  it('errors when APP_DEBUG=1', async () => {
    const restore = setEnv({ APP_DEBUG: '1' })
    try {
      const c = await findCheck('production:app-debug')
      assert.equal((await c.run()).status, 'error')
    } finally { restore() }
  })

  it('passes when APP_DEBUG is false / unset', async () => {
    const restore = setEnv({ APP_DEBUG: 'false' })
    try {
      const c = await findCheck('production:app-debug')
      assert.equal((await c.run()).status, 'ok')
    } finally { restore() }

    const restore2 = setEnv({ APP_DEBUG: undefined })
    try {
      const c = await findCheck('production:app-debug')
      assert.equal((await c.run()).status, 'ok')
    } finally { restore2() }
  })
})

// ── APP_URL ──────────────────────────────────────────────────

describe('production check — APP_URL must be HTTPS', () => {
  it('errors on http:// URLs', async () => {
    const restore = setEnv({ APP_URL: 'http://example.com' })
    try {
      const c = await findCheck('production:app-url')
      const r = await c.run()
      assert.equal(r.status, 'error')
      assert.match(r.message, /plain HTTP/)
    } finally { restore() }
  })

  it('passes on https:// URLs', async () => {
    const restore = setEnv({ APP_URL: 'https://example.com' })
    try {
      const c = await findCheck('production:app-url')
      assert.equal((await c.run()).status, 'ok')
    } finally { restore() }
  })

  it('warns when APP_URL unset', async () => {
    const restore = setEnv({ APP_URL: undefined })
    try {
      const c = await findCheck('production:app-url')
      assert.equal((await c.run()).status, 'warn')
    } finally { restore() }
  })
})

// ── DATABASE_URL ─────────────────────────────────────────────

describe('production check — DATABASE_URL must point at a real database', () => {
  it('errors on file: (SQLite)', async () => {
    const restore = setEnv({ DATABASE_URL: 'file:./dev.db' })
    try {
      const c = await findCheck('production:database-url')
      const r = await c.run()
      assert.equal(r.status, 'error')
      assert.match(r.message, /SQLite/)
    } finally { restore() }
  })

  it('errors on localhost / 127.0.0.1', async () => {
    for (const host of ['localhost', '127.0.0.1', '0.0.0.0']) {
      const restore = setEnv({ DATABASE_URL: `postgres://u:p@${host}:5432/d` })
      try {
        const c = await findCheck('production:database-url')
        assert.equal((await c.run()).status, 'error', `should error for ${host}`)
      } finally { restore() }
    }
  })

  it('passes on a real remote DSN and REDACTS credentials in the message', async () => {
    const restore = setEnv({ DATABASE_URL: 'postgres://user:secret@db.example.com:5432/app' })
    try {
      const c = await findCheck('production:database-url')
      const r = await c.run()
      assert.equal(r.status, 'ok')
      assert.match(r.message, /\[redacted\]/)
      assert.doesNotMatch(r.message, /secret/)
    } finally { restore() }
  })

  it('is ok when DATABASE_URL is unset (non-DB app)', async () => {
    const restore = setEnv({ DATABASE_URL: undefined })
    try {
      const c = await findCheck('production:database-url')
      assert.equal((await c.run()).status, 'ok')
    } finally { restore() }
  })
})

// ── Pinning + workspace + dist + manifest ────────────────────

describe('production checks — package.json + build invariants', () => {
  let tmp: string
  let cwd: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rudder-prod-'))
    cwd = process.cwd()
    process.chdir(tmp)
  })
  afterEach(async () => {
    process.chdir(cwd)
    await fs.rm(tmp, { recursive: true, force: true })
  })

  it('flags @rudderjs/* deps on floating ranges', async () => {
    await fs.writeFile('package.json', JSON.stringify({
      dependencies: { '@rudderjs/core': 'latest', '@rudderjs/cli': '^1.0.0' },
    }))
    const c = await findCheck('production:rudder-pinning')
    const r = await c.run()
    assert.equal(r.status, 'warn')
    assert.match(r.message, /@rudderjs\/core/)
    assert.doesNotMatch(r.message, /@rudderjs\/cli/)
  })

  it('passes when every @rudderjs/* dep is pinned', async () => {
    await fs.writeFile('package.json', JSON.stringify({
      dependencies: { '@rudderjs/core': '^1.5.1', '@rudderjs/cli': '^4.7.0' },
    }))
    const c = await findCheck('production:rudder-pinning')
    assert.equal((await c.run()).status, 'ok')
  })

  it('flags workspace: refs', async () => {
    await fs.writeFile('package.json', JSON.stringify({
      dependencies: { '@rudderjs/core': 'workspace:^' },
    }))
    const c = await findCheck('production:workspace-refs')
    const r = await c.run()
    assert.equal(r.status, 'error')
    assert.match(r.message, /workspace:/)
  })

  it('passes when no workspace: refs', async () => {
    await fs.writeFile('package.json', JSON.stringify({
      dependencies: { '@rudderjs/core': '^1.5.0' },
    }))
    const c = await findCheck('production:workspace-refs')
    assert.equal((await c.run()).status, 'ok')
  })

  it('errors when dist/ is missing', async () => {
    const c = await findCheck('production:dist-exists')
    assert.equal((await c.run()).status, 'error')
  })

  it('passes when dist/ exists', async () => {
    await fs.mkdir('dist')
    const c = await findCheck('production:dist-exists')
    assert.equal((await c.run()).status, 'ok')
  })

  it('errors when providers manifest is missing', async () => {
    const c = await findCheck('production:providers-manifest')
    assert.equal((await c.run()).status, 'error')
  })

  it('passes when providers manifest exists', async () => {
    await fs.mkdir(path.join('bootstrap', 'cache'), { recursive: true })
    await fs.writeFile(path.join('bootstrap', 'cache', 'providers.json'), '[]')
    const c = await findCheck('production:providers-manifest')
    assert.equal((await c.run()).status, 'ok')
  })
})

// ── All checks are productionOnly ────────────────────────────

describe('production checks — gating', () => {
  it('every production:* check has productionOnly=true', async () => {
    const all = await loadProduction()
    const prodChecks = all.filter((c) => c.id.startsWith('production:'))
    assert.ok(prodChecks.length > 0, 'no production:* checks registered')
    for (const c of prodChecks) {
      assert.equal(c.productionOnly, true, `${c.id} must be productionOnly`)
    }
  })
})
