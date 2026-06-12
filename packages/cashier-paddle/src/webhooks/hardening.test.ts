import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { dispatcher } from '@rudderjs/core'

import {
  Cashier,
  verifyPaddleWebhook,
  handlePaddleWebhook,
  syncSubscriptionItems,
} from '../index.js'

// ─── Helpers ──────────────────────────────────────────────

const SECRET = 'whsec_test'

function sign(ts: number | string, body: string, secret = SECRET): string {
  const h1 = crypto.createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')
  return `ts=${ts};h1=${h1}`
}

function makeRes(): { res: any; out: { code: number; body: unknown } } {
  const out = { code: 0, body: undefined as unknown }
  const res = {
    status(c: number) { out.code = c; return res },
    json(b: unknown) { out.body = b; return res },
  }
  return { res, out }
}

function makeReq(sigHeader: string, body: string): any {
  return {
    headers: { 'paddle-signature': sigHeader },
    raw: { __rjs_paddle_raw_body: body },
  }
}

// ─── Fix (a): replay window ───────────────────────────────

describe('verifyPaddleWebhook — replay window', () => {
  beforeEach(() => {
    Cashier.reset()
    Cashier.configure({ webhookSecret: SECRET })
  })

  test('accepts a valid signature with a fresh timestamp', async () => {
    const body = '{"event_id":"evt_1"}'
    const ts   = Math.floor(Date.now() / 1000)
    let nexted = false
    const { res, out } = makeRes()
    await verifyPaddleWebhook()(makeReq(sign(ts, body), body), res, async () => { nexted = true })
    assert.equal(nexted, true)
    assert.equal(out.code, 0)
  })

  test('rejects a valid signature whose timestamp is outside the tolerance (replay)', async () => {
    const body = '{"event_id":"evt_1"}'
    const ts   = Math.floor(Date.now() / 1000) - 1000 // > 300s old
    let nexted = false
    const { res, out } = makeRes()
    await verifyPaddleWebhook()(makeReq(sign(ts, body), body), res, async () => { nexted = true })
    assert.equal(nexted, false, 'stale request must not reach the handler')
    assert.equal(out.code, 403)
    assert.deepEqual(out.body, { error: 'timestamp_out_of_tolerance' })
  })

  test('tolerance 0 disables the replay window', async () => {
    Cashier.webhookTolerance(0)
    const body = '{"event_id":"evt_1"}'
    const ts   = Math.floor(Date.now() / 1000) - 100_000
    let nexted = false
    const { res } = makeRes()
    await verifyPaddleWebhook()(makeReq(sign(ts, body), body), res, async () => { nexted = true })
    assert.equal(nexted, true)
  })

  test('a bad signature still fails 401 before the timestamp is considered', async () => {
    const body = '{"event_id":"evt_1"}'
    const ts   = Math.floor(Date.now() / 1000)
    const header = `ts=${ts};h1=${'0'.repeat(64)}`
    const { res, out } = makeRes()
    let nexted = false
    await verifyPaddleWebhook()(makeReq(header, body), res, async () => { nexted = true })
    assert.equal(nexted, false)
    assert.equal(out.code, 401)
  })
})

// ─── Fix (b): subscription item persistence ───────────────

// Stub SubscriptionItem model — captures writes without a DB.
class FakeItem {
  static rows: Array<Record<string, any>> = []
  static creates: Array<Record<string, any>> = []
  static updates: Array<{ id: string; data: Record<string, any> }> = []
  static deletes: string[] = []
  static seq = 0

  static reset(): void {
    this.rows = []; this.creates = []; this.updates = []; this.deletes = []; this.seq = 0
  }

  static where(col: string, val: unknown) {
    return { async get() { return FakeItem.rows.filter((r) => r[col] === val) } }
  }
  static async create(data: Record<string, any>) {
    const row = { id: `item_${++this.seq}`, ...data }
    this.creates.push(data); this.rows.push(row)
    return row
  }
  static async update(id: string, data: Record<string, any>) {
    this.updates.push({ id, data })
    const row = this.rows.find((r) => r.id === id)
    if (row) Object.assign(row, data)
  }
  static async delete(id: string) {
    this.deletes.push(id)
    this.rows = this.rows.filter((r) => r.id !== id)
  }
}

describe('syncSubscriptionItems', () => {
  beforeEach(() => {
    Cashier.reset()
    FakeItem.reset()
    Cashier.useSubscriptionItemModel(FakeItem as unknown as Parameters<typeof Cashier.useSubscriptionItemModel>[0])
  })

  test('creates rows for incoming items on an empty subscription', async () => {
    await syncSubscriptionItems('sub_1', [
      { priceId: 'pri_a', productId: 'prod_a', quantity: 2, status: 'active' },
      { priceId: 'pri_b', productId: 'prod_b', quantity: 1, status: 'active' },
    ])
    assert.equal(FakeItem.creates.length, 2)
    assert.equal(FakeItem.updates.length, 0)
    assert.equal(FakeItem.deletes.length, 0)
    assert.deepEqual(FakeItem.creates[0], {
      subscriptionId: 'sub_1', productId: 'prod_a', priceId: 'pri_a', quantity: 2, status: 'active',
    })
  })

  test('upserts an existing item by priceId rather than duplicating', async () => {
    FakeItem.rows.push({ id: 'item_existing', subscriptionId: 'sub_1', priceId: 'pri_a', productId: 'prod_a', quantity: 1, status: 'active' })
    await syncSubscriptionItems('sub_1', [
      { priceId: 'pri_a', productId: 'prod_a', quantity: 5, status: 'active' }, // changed qty
      { priceId: 'pri_b', productId: 'prod_b', quantity: 1, status: 'active' }, // new
    ])
    assert.equal(FakeItem.updates.length, 1)
    assert.equal(FakeItem.updates[0]!.id, 'item_existing')
    assert.equal(FakeItem.updates[0]!.data['quantity'], 5)
    assert.equal(FakeItem.creates.length, 1)
    assert.equal(FakeItem.creates[0]!['priceId'], 'pri_b')
    assert.equal(FakeItem.deletes.length, 0)
  })

  test('prunes items no longer present on the subscription', async () => {
    FakeItem.rows.push({ id: 'item_keep', subscriptionId: 'sub_1', priceId: 'pri_a', productId: 'prod_a', quantity: 1, status: 'active' })
    FakeItem.rows.push({ id: 'item_drop', subscriptionId: 'sub_1', priceId: 'pri_b', productId: 'prod_b', quantity: 1, status: 'active' })
    await syncSubscriptionItems('sub_1', [
      { priceId: 'pri_a', productId: 'prod_a', quantity: 1, status: 'active' },
    ])
    assert.deepEqual(FakeItem.deletes, ['item_drop'])
  })

  test('ignores items with an empty priceId', async () => {
    await syncSubscriptionItems('sub_1', [
      { priceId: '', productId: 'prod_x', quantity: 1, status: 'active' },
    ])
    assert.equal(FakeItem.creates.length, 0)
  })
})

// ─── Fix (b): handler persists items end-to-end ───────────

// Minimal Subscription / Customer stubs for the handler path.
class FakeSub {
  static created: Record<string, any> | null = null
  static where(col: string, val: unknown) {
    return {
      async first() {
        if (col === 'paddleId') return null            // always treat as new
        if (col === 'id' && val === FakeSub.created?.id) return FakeSub.created
        return null
      },
    }
  }
  static async create(data: Record<string, any>) {
    FakeSub.created = { id: 'sub_local_1', ...data }
    return FakeSub.created
  }
  static async update() { /* not exercised on the create path */ }
}

class FakeCustomerNone {
  static where() { return { async first() { return null } } }
}

describe('handlePaddleWebhook persists subscription items', () => {
  beforeEach(() => {
    Cashier.reset()
    FakeItem.reset()
    FakeSub.created = null
    Cashier.useSubscriptionItemModel(FakeItem as unknown as Parameters<typeof Cashier.useSubscriptionItemModel>[0])
    Cashier.useSubscriptionModel(FakeSub as unknown as Parameters<typeof Cashier.useSubscriptionModel>[0])
    Cashier.useCustomerModel(FakeCustomerNone as unknown as Parameters<typeof Cashier.useCustomerModel>[0])
  })

  test('subscription.created writes the line items to paddle_subscription_items', async () => {
    const payload = {
      event_type: 'subscription.created',
      // no event_id → idempotency gate is skipped (no WebhookLog stub needed)
      data: {
        id: 'sub_paddle_1',
        status: 'active',
        customer_id: 'cus_1',
        items: [
          { price: { id: 'pri_a' }, product: { id: 'prod_a' }, quantity: 2, status: 'active' },
        ],
      },
    }
    const { res, out } = makeRes()
    await handlePaddleWebhook({ raw: { __rjs_paddle_payload: payload } } as any, res as any)

    assert.equal(out.code, 200)
    assert.equal(FakeItem.creates.length, 1, 'handler must persist the parsed item')
    assert.equal(FakeItem.creates[0]!['priceId'], 'pri_a')
    assert.equal(FakeItem.creates[0]!['quantity'], 2)
    assert.equal(FakeItem.creates[0]!['subscriptionId'], 'sub_local_1')
  })
})

// ─── Fix (c): re-read after the secondary update ──────────

// Existing-subscription stub. Each write bumps `updatedAt` to a new version so
// a dispatched record sourced from a re-read (v2) is distinguishable from one
// sourced from the in-memory patch (v1 + a manual field set).
class FakeSubExisting {
  static persisted: Record<string, any> = {}
  static version = 0
  static reset(): void {
    this.version = 0
    this.persisted = { id: 'sub_local_1', paddleId: 'sub_paddle_1', paddleStatus: 'active', pausedAt: null, endsAt: null, updatedAt: 'v0' }
  }
  static where(col: string, _val: unknown) {
    return { async first() { return col === 'paddleId' || col === 'id' ? { ...FakeSubExisting.persisted } : null } }
  }
  static async create() { throw new Error('existing path expected — create() must not run') }
  static async update(_id: string, data: Record<string, any>) {
    this.version++
    Object.assign(this.persisted, data, { updatedAt: `v${this.version}` })
  }
}

describe('handler re-reads the row after the secondary stamp (paused/canceled)', () => {
  const seen: { paused: any; canceled: any } = { paused: null, canceled: null }
  dispatcher.register('SubscriptionPaused',   { handle(e: any) { seen.paused = e.subscription } } as any)
  dispatcher.register('SubscriptionCanceled', { handle(e: any) { seen.canceled = e.subscription } } as any)

  beforeEach(() => {
    Cashier.reset()
    seen.paused = null; seen.canceled = null
    FakeSubExisting.reset(); FakeItem.reset()
    Cashier.useSubscriptionModel(FakeSubExisting as unknown as Parameters<typeof Cashier.useSubscriptionModel>[0])
    Cashier.useSubscriptionItemModel(FakeItem as unknown as Parameters<typeof Cashier.useSubscriptionItemModel>[0])
    Cashier.useCustomerModel(FakeCustomerNone as unknown as Parameters<typeof Cashier.useCustomerModel>[0])
  })

  test('subscription.paused dispatches the re-read record (not the in-memory patch)', async () => {
    const payload = { event_type: 'subscription.paused', data: { id: 'sub_paddle_1', status: 'paused', customer_id: 'cus_1', items: [] } }
    const { res } = makeRes()
    await handlePaddleWebhook({ raw: { __rjs_paddle_payload: payload } } as any, res as any)
    assert.ok(seen.paused, 'SubscriptionPaused must dispatch')
    assert.ok(seen.paused.pausedAt, 'pausedAt must be stamped')
    assert.equal(seen.paused.updatedAt, 'v2', 'event must carry the re-read row (post secondary write), not the v1 snapshot')
  })

  test('subscription.canceled dispatches the re-read record', async () => {
    const payload = { event_type: 'subscription.canceled', data: { id: 'sub_paddle_1', status: 'canceled', customer_id: 'cus_1', items: [] } }
    const { res } = makeRes()
    await handlePaddleWebhook({ raw: { __rjs_paddle_payload: payload } } as any, res as any)
    assert.ok(seen.canceled, 'SubscriptionCanceled must dispatch')
    assert.ok(seen.canceled.endsAt, 'endsAt must be stamped')
    assert.equal(seen.canceled.updatedAt, 'v2', 'event must carry the re-read row, not the v1 snapshot')
  })
})
