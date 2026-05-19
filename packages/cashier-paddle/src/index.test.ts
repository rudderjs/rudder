import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  Cashier,
  formatAmount,
  subscriptionHelpers,
  customerHelpers,
  transactionHelpers,
  isSubscribed,
  isActive,
  onTrial,
  isPastDue,
  onGracePeriod,
  onPausedGracePeriod,
  Checkout,
  normalizePrices,
  WebhookReceived,
  WebhookHandled,
  SubscriptionCreated,
  SubscriptionUpdated,
  SubscriptionPaused,
  SubscriptionCanceled,
  CustomerUpdated,
  TransactionCompleted,
  TransactionUpdated,
  fromCustomerUpdated,
  fromSubscriptionEvent,
  fromSubscriptionPaused,
  fromSubscriptionCanceled,
  fromTransactionEvent,
  Billable,
  BillablePaddleError,
  setPaddleClientForTesting,
  resetPaddleClient,
} from './index.js'

import type {
  SubscriptionRecord,
  CustomerRecord,
  TransactionRecord,
} from './index.js'

// ─── Fixtures ─────────────────────────────────────────────

const SOON  = new Date(Date.now() + 60 * 60 * 1000)
const PAST  = new Date(Date.now() - 60 * 60 * 1000)

const baseSub: SubscriptionRecord = {
  id:               'sub_local_1',
  paddleId:         'sub_paddle_1',
  type:             'default',
  paddleStatus:     'active',
  paddleProductId:  'prod_1',
  billableId:       'user_1',
  billableType:     'User',
  trialEndsAt:      null,
  pausedAt:         null,
  endsAt:           null,
  createdAt:        new Date(),
  updatedAt:        new Date(),
}

function sub(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return { ...baseSub, ...overrides }
}

// ─── Cashier static config ────────────────────────────────

describe('Cashier (static config)', () => {
  test('configure() round-trips credentials', () => {
    Cashier.reset()
    Cashier.configure({ apiKey: 'k', clientSideToken: 't', webhookSecret: 's', sandbox: true })
    assert.equal(Cashier.apiKey(), 'k')
    assert.equal(Cashier.clientSideToken(), 't')
    assert.equal(Cashier.webhookSecret(), 's')
    assert.equal(Cashier.sandbox(), true)
  })

  test('reset() clears state', () => {
    Cashier.configure({ apiKey: 'k' })
    Cashier.reset()
    assert.equal(Cashier.apiKey(), null)
    assert.equal(Cashier.sandbox(), false)
    assert.equal(Cashier.webhookPath(), '/paddle/webhook')
  })

  test('keepPastDueSubscriptionsActive() flips the flag', () => {
    Cashier.reset()
    assert.equal(Cashier.pastDueIsActive(), false)
    Cashier.keepPastDueSubscriptionsActive()
    assert.equal(Cashier.pastDueIsActive(), true)
    Cashier.keepPastDueSubscriptionsActive(false)
    assert.equal(Cashier.pastDueIsActive(), false)
  })

  test('default values', () => {
    Cashier.reset()
    assert.equal(Cashier.currency(), 'USD')
    assert.equal(Cashier.currencyLocale(), 'en')
    assert.equal(Cashier.webhookPath(), '/paddle/webhook')
    assert.equal(Cashier.routesIgnored(), false)
  })
})

// ─── subscriptionHelpers state predicates ─────────────────

describe('subscriptionHelpers', () => {
  test('isActive: active + no grace', () => {
    assert.equal(subscriptionHelpers.isActive(sub({ paddleStatus: 'active' })), true)
  })
  test('isActive: false on canceled-on-grace (active flag would mislead)', () => {
    assert.equal(subscriptionHelpers.isActive(sub({ paddleStatus: 'active', endsAt: SOON })), false)
  })
  test('isTrialing reads paddleStatus only', () => {
    assert.equal(subscriptionHelpers.isTrialing(sub({ paddleStatus: 'trialing' })), true)
    assert.equal(subscriptionHelpers.isTrialing(sub({ paddleStatus: 'active' })),   false)
  })
  test('onTrial: trialing status OR future trialEndsAt', () => {
    assert.equal(subscriptionHelpers.onTrial(sub({ paddleStatus: 'trialing' })), true)
    assert.equal(subscriptionHelpers.onTrial(sub({ trialEndsAt: SOON })),        true)
    assert.equal(subscriptionHelpers.onTrial(sub({ trialEndsAt: PAST })),        false)
  })
  test('hasExpiredTrial: trialEndsAt in the past', () => {
    assert.equal(subscriptionHelpers.hasExpiredTrial(sub({ trialEndsAt: PAST })), true)
    assert.equal(subscriptionHelpers.hasExpiredTrial(sub({ trialEndsAt: SOON })), false)
    assert.equal(subscriptionHelpers.hasExpiredTrial(sub()),                       false)
  })
  test('isPastDue / isPaused / isCanceled', () => {
    assert.equal(subscriptionHelpers.isPastDue(sub({ paddleStatus: 'past_due' })), true)
    assert.equal(subscriptionHelpers.isPaused(sub({ paddleStatus: 'paused' })),    true)
    assert.equal(subscriptionHelpers.isCanceled(sub({ paddleStatus: 'canceled' })),true)
  })
  test('onGracePeriod: endsAt in the future', () => {
    assert.equal(subscriptionHelpers.onGracePeriod(sub({ endsAt: SOON })), true)
    assert.equal(subscriptionHelpers.onGracePeriod(sub({ endsAt: PAST })), false)
    assert.equal(subscriptionHelpers.onGracePeriod(sub()),                  false)
  })
  test('onPausedGracePeriod: pausedAt in the future', () => {
    assert.equal(subscriptionHelpers.onPausedGracePeriod(sub({ pausedAt: SOON })), true)
    assert.equal(subscriptionHelpers.onPausedGracePeriod(sub({ pausedAt: PAST })), false)
  })
  test('ended: endsAt in the past', () => {
    assert.equal(subscriptionHelpers.ended(sub({ endsAt: PAST })), true)
    assert.equal(subscriptionHelpers.ended(sub({ endsAt: SOON })), false)
  })
  test('isValid: active', () => {
    assert.equal(subscriptionHelpers.isValid(sub({ paddleStatus: 'active' })), true)
  })
  test('isValid: paused-on-grace true; paused-no-grace false', () => {
    assert.equal(subscriptionHelpers.isValid(sub({ paddleStatus: 'paused', pausedAt: SOON })), true)
    assert.equal(subscriptionHelpers.isValid(sub({ paddleStatus: 'paused', pausedAt: PAST })), false)
  })
  test('isValid: canceled-on-grace true; ended false', () => {
    assert.equal(subscriptionHelpers.isValid(sub({ paddleStatus: 'canceled', endsAt: SOON })), true)
    assert.equal(subscriptionHelpers.isValid(sub({ paddleStatus: 'canceled', endsAt: PAST })), false)
  })
  test('isValid: past_due gated by keepPastDueActive flag', () => {
    const r = sub({ paddleStatus: 'past_due' })
    assert.equal(subscriptionHelpers.isValid(r),                                 false)
    assert.equal(subscriptionHelpers.isValid(r, { keepPastDueActive: true }),    true)
  })
})

// ─── state.ts umbrella predicates ─────────────────────────

describe('state.ts predicates', () => {
  test('isSubscribed reads Cashier.pastDueIsActive() at call time', () => {
    Cashier.reset()
    const r = sub({ paddleStatus: 'past_due' })
    assert.equal(isSubscribed(r), false)
    Cashier.keepPastDueSubscriptionsActive()
    assert.equal(isSubscribed(r), true)
    Cashier.reset()
  })
  test('null/undefined inputs return false', () => {
    assert.equal(isSubscribed(null),         false)
    assert.equal(isActive(undefined),        false)
    assert.equal(onTrial(null),              false)
    assert.equal(isPastDue(null),            false)
    assert.equal(onGracePeriod(null),        false)
    assert.equal(onPausedGracePeriod(null),  false)
  })
})

// ─── customerHelpers ──────────────────────────────────────

describe('customerHelpers', () => {
  const cust = (trialEndsAt: Date | null): CustomerRecord => ({
    id: 'c_1', paddleId: 'cus_1', billableId: 'u_1', billableType: 'User',
    name: null, email: null, trialEndsAt, createdAt: new Date(), updatedAt: new Date(),
  })

  test('onGenericTrial', () => {
    assert.equal(customerHelpers.onGenericTrial(cust(SOON)), true)
    assert.equal(customerHelpers.onGenericTrial(cust(PAST)), false)
    assert.equal(customerHelpers.onGenericTrial(cust(null)), false)
  })
  test('hasExpiredGenericTrial', () => {
    assert.equal(customerHelpers.hasExpiredGenericTrial(cust(PAST)), true)
    assert.equal(customerHelpers.hasExpiredGenericTrial(cust(SOON)), false)
    assert.equal(customerHelpers.hasExpiredGenericTrial(cust(null)), false)
  })
})

// ─── transactionHelpers ───────────────────────────────────

describe('transactionHelpers', () => {
  const tx = (overrides: Partial<TransactionRecord> = {}): TransactionRecord => ({
    id: 't_1', paddleId: 'txn_1', paddleCustomerId: null, paddleSubscriptionId: null,
    billableId: 'u_1', billableType: 'User', invoiceNumber: null,
    status: 'completed', total: '1999', tax: '199', currency: 'USD',
    billedAt: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  })

  test('rawSubtotal: total - tax via BigInt', () => {
    assert.equal(transactionHelpers.rawSubtotal(tx({ total: '1999', tax: '199' })), '1800')
    assert.equal(transactionHelpers.rawSubtotal(tx({ total: '5000', tax: '0'   })), '5000')
  })
  test('rawSubtotal falls back to total on parse failure', () => {
    assert.equal(transactionHelpers.rawSubtotal(tx({ total: 'oops', tax: '0' })), 'oops')
  })
  test('isCompleted / isPaid / isPastDue', () => {
    assert.equal(transactionHelpers.isCompleted(tx({ status: 'completed' })), true)
    assert.equal(transactionHelpers.isPaid(tx({ status: 'paid' })),           true)
    assert.equal(transactionHelpers.isPaid(tx({ status: 'completed' })),      true)
    assert.equal(transactionHelpers.isPastDue(tx({ status: 'past_due' })),    true)
  })
})

// ─── formatAmount ─────────────────────────────────────────

describe('formatAmount', () => {
  test('USD: 2 minor units', () => {
    assert.match(formatAmount('1999', 'USD', 'en-US'), /\$19\.99/)
  })
  test('JPY: 0 minor units', () => {
    assert.match(formatAmount('19000', 'JPY', 'en-US'), /¥19,000/)
  })
  test('uses Cashier.currencyLocale() default', () => {
    Cashier.reset()
    Cashier.currencyLocale('en-US')
    assert.match(formatAmount('500', 'USD'), /\$5\.00/)
    Cashier.reset()
  })
  test('handles numeric input', () => {
    assert.match(formatAmount(2500, 'USD', 'en-US'), /\$25\.00/)
  })
})

// ─── Checkout value object ────────────────────────────────

describe('Checkout', () => {
  test('options() round-trip with priceId + quantity', () => {
    const c = new Checkout({ items: [{ priceId: 'pri_a', quantity: 2 }] })
    const opts = c.options()
    assert.deepEqual(opts.items, [{ priceId: 'pri_a', quantity: 2 }])
  })
  test('builders are chainable + getters reflect state', () => {
    const c = new Checkout()
      .addItem('pri_x')
      .returnTo('/done')
      .customData({ orderRef: 'ORD-9' })
      .customer('cus_1')
      .discount('dsc_1')
    assert.deepEqual(c.getItems(),       [{ priceId: 'pri_x', quantity: 1 }])
    assert.equal(c.getReturnUrl(),       '/done')
    assert.deepEqual(c.getCustomData(), { orderRef: 'ORD-9' })
    assert.deepEqual(c.getCustomer(),   { id: 'cus_1' })
    assert.equal(c.getDiscountId(),     'dsc_1')
  })
  test('Checkout.guest() — no customer', () => {
    const c = Checkout.guest(['pri_a', 'pri_b'])
    assert.deepEqual(c.getItems(), [
      { priceId: 'pri_a', quantity: 1 },
      { priceId: 'pri_b', quantity: 1 },
    ])
    assert.equal(c.getCustomer(), null)
  })
  test('options() emits successUrl + customer', () => {
    const c = new Checkout().addItem('pri_a').returnTo('/x').customer('cus_1')
    const opts = c.options()
    assert.equal(opts.settings?.successUrl, '/x')
    assert.equal(opts.customer?.id, 'cus_1')
  })
  test('normalizePrices handles strings and objects', () => {
    assert.deepEqual(normalizePrices(['pri_a']),                       [{ priceId: 'pri_a', quantity: 1 }])
    assert.deepEqual(normalizePrices([{ priceId: 'pri_b', quantity: 3 }]), [{ priceId: 'pri_b', quantity: 3 }])
  })
})

// ─── Webhook event classes ────────────────────────────────

describe('webhook events', () => {
  test('event class names match dispatcher key', () => {
    assert.equal(WebhookReceived.name,        'WebhookReceived')
    assert.equal(WebhookHandled.name,         'WebhookHandled')
    assert.equal(SubscriptionCreated.name,    'SubscriptionCreated')
    assert.equal(SubscriptionUpdated.name,    'SubscriptionUpdated')
    assert.equal(SubscriptionPaused.name,     'SubscriptionPaused')
    assert.equal(SubscriptionCanceled.name,   'SubscriptionCanceled')
    assert.equal(CustomerUpdated.name,        'CustomerUpdated')
    assert.equal(TransactionCompleted.name,   'TransactionCompleted')
    assert.equal(TransactionUpdated.name,     'TransactionUpdated')
  })
  test('payload is exposed', () => {
    const e = new WebhookReceived('subscription.created', { event_id: 'evt_1' })
    assert.equal(e.eventType, 'subscription.created')
    assert.deepEqual(e.payload, { event_id: 'evt_1' })
  })
})

// ─── Webhook transformers ─────────────────────────────────

describe('webhook transformers', () => {
  test('fromCustomerUpdated extracts paddle id + name + email', () => {
    const r = fromCustomerUpdated({
      data: { id: 'ctm_1', name: 'Alice', email: 'a@example.com' },
    })
    assert.deepEqual(r, { paddleId: 'ctm_1', name: 'Alice', email: 'a@example.com' })
  })
  test('fromCustomerUpdated returns null for missing data.id', () => {
    assert.equal(fromCustomerUpdated({}),                            null)
    assert.equal(fromCustomerUpdated({ data: { name: 'No Id' } }),    null)
  })
  test('fromSubscriptionEvent reads first item product as paddleProductId', () => {
    const r = fromSubscriptionEvent({
      data: {
        id: 'sub_1',
        status: 'active',
        customer_id: 'cus_1',
        items: [{ price: { id: 'pri_1' }, product: { id: 'prod_1' }, quantity: 1, status: 'active' }],
      },
    })
    assert.ok(r)
    assert.equal(r!.paddleId,         'sub_1')
    assert.equal(r!.paddleStatus,     'active')
    assert.equal(r!.paddleCustomerId, 'cus_1')
    assert.equal(r!.paddleProductId,  'prod_1')
    assert.deepEqual(r!.items, [{
      priceId: 'pri_1', productId: 'prod_1', quantity: 1, status: 'active',
    }])
  })
  test('fromSubscriptionEvent reads scheduled_change for pause/cancel', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    const paused = fromSubscriptionEvent({
      data: { id: 's', status: 'active', items: [],
              scheduled_change: { action: 'pause', effective_at: future } },
    })
    assert.ok(paused?.pausedAt)

    const canceled = fromSubscriptionEvent({
      data: { id: 's', status: 'active', items: [],
              scheduled_change: { action: 'cancel', effective_at: future } },
    })
    assert.ok(canceled?.endsAt)
  })
  test('fromSubscriptionPaused stamps pausedAt when missing', () => {
    const r = fromSubscriptionPaused({
      data: { id: 's', status: 'paused', items: [] },
    })
    assert.ok(r?.pausedAt)
  })
  test('fromSubscriptionCanceled stamps endsAt when missing', () => {
    const r = fromSubscriptionCanceled({
      data: { id: 's', status: 'canceled', items: [] },
    })
    assert.ok(r?.endsAt)
  })
  test('fromTransactionEvent reads totals', () => {
    const r = fromTransactionEvent({
      data: {
        id: 'txn_1',
        customer_id: 'cus_1',
        subscription_id: 'sub_1',
        invoice_number: 'INV-001',
        status: 'completed',
        currency_code: 'USD',
        billed_at: new Date().toISOString(),
        details: { totals: { total: '5000', tax: '500' } },
      },
    })
    assert.ok(r)
    assert.equal(r!.paddleId,             'txn_1')
    assert.equal(r!.paddleCustomerId,     'cus_1')
    assert.equal(r!.paddleSubscriptionId, 'sub_1')
    assert.equal(r!.invoiceNumber,        'INV-001')
    assert.equal(r!.status,               'completed')
    assert.equal(r!.total,                '5000')
    assert.equal(r!.tax,                  '500')
    assert.equal(r!.currency,             'USD')
  })
  test('fromTransactionEvent returns null without data.id', () => {
    assert.equal(fromTransactionEvent({}), null)
  })
})

// ─── Billable.createAsCustomer (error handling) ───────────

describe('Billable.createAsCustomer', () => {
  // Stub Customer model that captures create() args without touching a DB.
  class FakeCustomer {
    static lastCreateArgs: Record<string, unknown> | null = null
    static async create(attrs: Record<string, unknown>): Promise<Record<string, unknown>> {
      this.lastCreateArgs = attrs
      return { id: 'cust_local_1', ...attrs }
    }
  }

  class StubUser {
    id = 'user_1'
    name = 'Alice'
    email = 'alice@example.com'
  }
  // The Billable factory returns an abstract class (`abstract class _Billable extends Base`).
  // Cast it to a concrete constructor for direct instantiation in tests.
  const BilledUser = Billable(StubUser as unknown as abstract new (...args: unknown[]) => { id: unknown }) as unknown as new () => StubUser & {
    createAsCustomer(opts?: { name?: string; email?: string; trialEndsAt?: Date }): Promise<unknown>
  }

  function setup(): void {
    Cashier.reset()
    Cashier.useCustomerModel(FakeCustomer as unknown as Parameters<typeof Cashier.useCustomerModel>[0])
    FakeCustomer.lastCreateArgs = null
    resetPaddleClient()
  }

  test('mock mode: no apiKey → SDK unavailable path → persists with paddleId=null', async () => {
    setup()
    // Cashier.apiKey() is null after reset, so paddle() throws — the outer
    // try should swallow that and fall through with paddleId = null.
    const user = new BilledUser()
    const rec = await user.createAsCustomer() as unknown as { paddleId: string | null }
    assert.equal(rec.paddleId, null)
    assert.equal(FakeCustomer.lastCreateArgs?.['paddleId'], null)
    assert.equal(FakeCustomer.lastCreateArgs?.['email'], 'alice@example.com')
  })

  test('SDK success: returned id is persisted on the local row', async () => {
    setup()
    setPaddleClientForTesting({
      customers: {
        create: async (_args: unknown) => ({ id: 'ctm_new' }),
      },
    })
    const user = new BilledUser()
    const rec = await user.createAsCustomer() as unknown as { paddleId: string | null }
    assert.equal(rec.paddleId, 'ctm_new')
    assert.equal(FakeCustomer.lastCreateArgs?.['paddleId'], 'ctm_new')
  })

  test('customer_email_in_use → BillablePaddleError with code, no local row written', async () => {
    setup()
    setPaddleClientForTesting({
      customers: {
        // Shape returned by the Paddle Billing API on 409.
        create: async () => {
          throw { error: { type: 'request_error', code: 'customer_email_in_use', detail: 'Already in use' } }
        },
      },
    })
    const user = new BilledUser()
    await assert.rejects(
      () => user.createAsCustomer(),
      (err: unknown) => {
        assert.ok(err instanceof BillablePaddleError, 'should be BillablePaddleError')
        assert.equal((err as BillablePaddleError).code, 'customer_email_in_use')
        return true
      },
    )
    // Critical: the local row was NOT persisted in the broken state.
    assert.equal(FakeCustomer.lastCreateArgs, null)
  })

  test('generic 5xx → BillablePaddleError (no code), original error preserved on .cause', async () => {
    setup()
    const upstream = new Error('boom — paddle internal error')
    setPaddleClientForTesting({
      customers: {
        create: async () => { throw upstream },
      },
    })
    const user = new BilledUser()
    await assert.rejects(
      () => user.createAsCustomer(),
      (err: unknown) => {
        assert.ok(err instanceof BillablePaddleError)
        assert.equal((err as BillablePaddleError).code, undefined)
        assert.equal((err as BillablePaddleError).cause, upstream)
        return true
      },
    )
    assert.equal(FakeCustomer.lastCreateArgs, null)
  })

  test('error code read from top-level .code (not just .error.code)', async () => {
    setup()
    setPaddleClientForTesting({
      customers: {
        create: async () => { throw { code: 'rate_limit_exceeded', message: 'Slow down.' } },
      },
    })
    const user = new BilledUser()
    await assert.rejects(
      () => user.createAsCustomer(),
      (err: unknown) => {
        assert.ok(err instanceof BillablePaddleError)
        assert.equal((err as BillablePaddleError).code, 'rate_limit_exceeded')
        return true
      },
    )
  })
})
