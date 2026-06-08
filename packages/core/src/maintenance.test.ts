import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import {
  isDownForMaintenance,
  maintenanceData,
  down,
  up,
  maintenanceMiddleware,
  MAINTENANCE_BYPASS_COOKIE,
} from './maintenance.js'

function scaffold(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-'))
}

function fakeReq(over: Partial<AppRequest> = {}): AppRequest {
  return {
    method: 'GET', url: '/', path: '/', query: {}, params: {},
    headers: {}, body: undefined, raw: undefined, ...over,
  } as AppRequest
}

interface CapturedRes extends AppResponse { headers: Record<string, string>; body: unknown }
function fakeRes(): CapturedRes {
  const res = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown } as CapturedRes
  res.status   = (c: number) => { res.statusCode = c; return res }
  res.header   = (k: string, v: string) => { res.headers[k] = v; return res }
  res.json     = (d: unknown) => { res.body = d }
  res.send     = (d: string) => { res.body = d }
  res.redirect = () => {}
  return res
}

describe('maintenance — flag file helpers', () => {
  let root = ''
  afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); root = '' })

  it('down() writes the flag file with the given data', () => {
    root = scaffold()
    assert.equal(isDownForMaintenance(root), false)
    down({ time: 123, message: 'brb', retry: 30, secret: 's3cr3t' }, root)
    assert.equal(isDownForMaintenance(root), true)
    const data = maintenanceData(root)
    assert.equal(data?.message, 'brb')
    assert.equal(data?.retry, 30)
    assert.equal(data?.secret, 's3cr3t')
    // Stored at storage/framework/down
    assert.ok(fs.existsSync(path.join(root, 'storage', 'framework', 'down')))
  })

  it('up() removes the flag and reports whether it was down', () => {
    root = scaffold()
    down({ time: 0 }, root)
    assert.equal(up(root), true)
    assert.equal(isDownForMaintenance(root), false)
    assert.equal(up(root), false) // already up
  })

  it('maintenanceData() returns null when up', () => {
    root = scaffold()
    assert.equal(maintenanceData(root), null)
  })
})

describe('maintenance — middleware', () => {
  let root = ''
  const prevCwd = process.cwd()
  afterEach(() => {
    process.chdir(prevCwd)
    if (root) fs.rmSync(root, { recursive: true, force: true })
    root = ''
  })

  const setup = (data?: Parameters<typeof down>[0]): void => {
    root = scaffold()
    process.chdir(root)
    if (data) down(data, root)
  }

  it('calls next() when the app is up', async () => {
    setup() // not down
    let nexted = false
    const res = fakeRes()
    await maintenanceMiddleware()(fakeReq(), res, async () => { nexted = true })
    assert.equal(nexted, true)
    assert.equal(res.statusCode, 200)
  })

  it('503s with Retry-After + message when down', async () => {
    setup({ time: 0, retry: 42, message: 'back soon' })
    let nexted = false
    const res = fakeRes()
    await maintenanceMiddleware()(fakeReq(), res, async () => { nexted = true })
    assert.equal(nexted, false)
    assert.equal(res.statusCode, 503)
    assert.equal(res.headers['Retry-After'], '42')
    assert.deepEqual(res.body, { message: 'back soon' })
  })

  it('lets a request with the correct ?secret through and sets a bypass cookie', async () => {
    setup({ time: 0, secret: 'open-sesame' })
    let nexted = false
    const res = fakeRes()
    await maintenanceMiddleware()(fakeReq({ query: { secret: 'open-sesame' } }), res, async () => { nexted = true })
    assert.equal(nexted, true)
    assert.match(res.headers['Set-Cookie'] ?? '', new RegExp(`${MAINTENANCE_BYPASS_COOKIE}=open-sesame`))
  })

  it('lets a request carrying the bypass cookie through', async () => {
    setup({ time: 0, secret: 'open-sesame' })
    let nexted = false
    const res = fakeRes()
    const req = fakeReq({ headers: { cookie: `${MAINTENANCE_BYPASS_COOKIE}=open-sesame` } })
    await maintenanceMiddleware()(req, res, async () => { nexted = true })
    assert.equal(nexted, true)
  })

  it('503s when the secret is wrong', async () => {
    setup({ time: 0, secret: 'open-sesame' })
    const res = fakeRes()
    await maintenanceMiddleware()(fakeReq({ query: { secret: 'nope' } }), res, async () => {})
    assert.equal(res.statusCode, 503)
  })

  it('honours the allow-list from the flag file and the except option', async () => {
    setup({ time: 0, allow: ['/health'] })
    const mw = maintenanceMiddleware({ except: ['/status*'] })

    let a = false, b = false, c = false
    await mw(fakeReq({ path: '/health' }),     fakeRes(), async () => { a = true })
    await mw(fakeReq({ path: '/status/live' }), fakeRes(), async () => { b = true })
    const blocked = fakeRes()
    await mw(fakeReq({ path: '/dashboard' }),  blocked,   async () => { c = true })

    assert.equal(a, true)  // flag-file allow
    assert.equal(b, true)  // except option (wildcard)
    assert.equal(c, false) // gated
    assert.equal(blocked.statusCode, 503)
  })

  it('never gates static assets / Vite internals even when down', async () => {
    setup({ time: 0 })
    let asset = false, vite = false
    await maintenanceMiddleware()(fakeReq({ path: '/app.css' }), fakeRes(), async () => { asset = true })
    await maintenanceMiddleware()(fakeReq({ path: '/@vite/client' }), fakeRes(), async () => { vite = true })
    assert.equal(asset, true)
    assert.equal(vite, true)
  })
})
