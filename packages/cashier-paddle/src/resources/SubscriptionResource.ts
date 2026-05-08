import { Cashier } from '../Cashier.js'
import { paddle } from '../paddle-client.js'
import { subscriptionHelpers } from '../models/helpers.js'
import { TransactionResource } from './TransactionResource.js'
import type { SubscriptionRecord, SubscriptionItemRecord, TransactionRecord } from '../contracts.js'

/**
 * Wrapper around a `paddle_subscriptions` row. Provides Cashier's fluent
 * subscription API.
 *
 * Why a wrapper class? `@rudderjs/orm` returns plain records (no prototype),
 * so chaining `record.cancel()` on a query result wouldn't work. The wrapper
 * is constructed by `Billable.subscription()` from a record and delegates
 * mutations to (a) the Paddle SDK and (b) static `Subscription.update(...)`.
 */
export class SubscriptionResource {
  /** The underlying record. Read-only — mutations refresh via `Subscription.update()`. */
  public readonly record: SubscriptionRecord

  // Cashier's `noProrate()` / `doNotBill()` chainable knobs apply to the next mutation.
  private _prorate = true
  private _bill    = true

  constructor(record: SubscriptionRecord) {
    this.record = record
  }

  // ─── State checks ────────────────────────────────────

  status():        string  { return this.record.paddleStatus }

  active():        boolean { return subscriptionHelpers.isActive(this.record) }
  recurring():     boolean { return subscriptionHelpers.isRecurring(this.record) }
  onTrial():       boolean { return subscriptionHelpers.onTrial(this.record) }
  expiredTrial():  boolean { return subscriptionHelpers.hasExpiredTrial(this.record) }
  pastDue():       boolean { return subscriptionHelpers.isPastDue(this.record) }
  paused():        boolean { return subscriptionHelpers.isPaused(this.record) }
  onPausedGracePeriod(): boolean { return subscriptionHelpers.onPausedGracePeriod(this.record) }
  canceled():      boolean { return subscriptionHelpers.isCanceled(this.record) }
  onGracePeriod(): boolean { return subscriptionHelpers.onGracePeriod(this.record) }
  ended():         boolean { return subscriptionHelpers.ended(this.record) }
  valid():         boolean {
    return subscriptionHelpers.isValid(this.record, { keepPastDueActive: Cashier.pastDueIsActive() })
  }

  // ─── Proration / billing knobs ──────────────────────

  noProrate(): this { this._prorate = false; return this }
  doNotBill(): this { this._bill    = false; return this }

  // ─── Plan changes ────────────────────────────────────

  /** Swap the subscription to a different price (or set of prices). */
  async swap(prices: string | string[]): Promise<SubscriptionResource> {
    const items = (Array.isArray(prices) ? prices : [prices]).map((priceId) => ({ priceId, quantity: 1 }))
    return this.callUpdate({
      items,
      prorationBillingMode: this._prorate ? 'prorated_immediately' : 'do_not_bill',
    })
  }

  /** Swap and bill the prorated amount immediately. */
  async swapAndInvoice(prices: string | string[]): Promise<SubscriptionResource> {
    const items = (Array.isArray(prices) ? prices : [prices]).map((priceId) => ({ priceId, quantity: 1 }))
    return this.callUpdate({
      items,
      prorationBillingMode: 'prorated_immediately',
    })
  }

  // ─── Quantity ────────────────────────────────────────

  async incrementQuantity(count = 1, priceId?: string): Promise<SubscriptionResource> {
    const items = await this.itemsForUpdate()
    const target = priceId ? items.findIndex((i) => i.priceId === priceId) : 0
    if (target === -1) throw new Error(`[RudderJS Cashier] No subscription item for priceId "${priceId}"`)
    const item = items[target]
    if (!item) throw new Error(`[RudderJS Cashier] Subscription has no item at index ${target}`)
    item.quantity += count
    return this.callUpdate({ items })
  }

  async decrementQuantity(count = 1, priceId?: string): Promise<SubscriptionResource> {
    return this.incrementQuantity(-count, priceId)
  }

  async updateQuantity(count: number, priceId?: string): Promise<SubscriptionResource> {
    const items = await this.itemsForUpdate()
    const target = priceId ? items.findIndex((i) => i.priceId === priceId) : 0
    if (target === -1) throw new Error(`[RudderJS Cashier] No subscription item for priceId "${priceId}"`)
    const item = items[target]
    if (!item) throw new Error(`[RudderJS Cashier] Subscription has no item at index ${target}`)
    item.quantity = count
    return this.callUpdate({ items })
  }

  async items(): Promise<SubscriptionItemRecord[]> {
    const Item = await Cashier.subscriptionItemModel()
    return await Item.where('subscriptionId', this.record.id).get() as unknown as SubscriptionItemRecord[]
  }

  // ─── One-time charges ────────────────────────────────

  /** Charge a one-off line on the subscription's next bill. */
  async charge(items: Array<{ priceId: string; quantity?: number }>): Promise<TransactionResource> {
    const client = await paddle()
    const fn = client.subscriptions['createOneTimeCharge'] ?? client.transactions['create']
    if (!fn) throw new Error('[RudderJS Cashier] Paddle SDK has no `subscriptions.createOneTimeCharge` method.')
    const result = await fn.call(client.subscriptions, this.record.paddleId, {
      items: items.map((i) => ({ priceId: i.priceId, quantity: i.quantity ?? 1 })),
    }) as { id: string; total?: string; tax?: string; currency?: string }
    return await this.materializeTransaction(result)
  }

  /** Charge and invoice immediately. */
  async chargeAndInvoice(items: Array<{ priceId: string; quantity?: number }>): Promise<TransactionResource> {
    return this.charge(items)
  }

  // ─── Pause ──────────────────────────────────────────

  async pause(): Promise<SubscriptionResource> {
    return this.callPause({ effectiveFrom: 'next_billing_period' })
  }
  async pauseNow(): Promise<SubscriptionResource> {
    return this.callPause({ effectiveFrom: 'immediately' })
  }
  async pauseUntil(date: Date): Promise<SubscriptionResource> {
    return this.callPause({ effectiveFrom: 'next_billing_period', resumeAt: date.toISOString() })
  }
  async pauseNowUntil(date: Date): Promise<SubscriptionResource> {
    return this.callPause({ effectiveFrom: 'immediately', resumeAt: date.toISOString() })
  }

  async resume(): Promise<SubscriptionResource> {
    const client = await paddle()
    const fn = client.subscriptions['resume']
    if (!fn) throw new Error('[RudderJS Cashier] Paddle SDK has no `subscriptions.resume` method.')
    const updated = await fn.call(client.subscriptions, this.record.paddleId, { effectiveFrom: 'immediately' }) as Record<string, unknown>
    return await this.refresh(updated)
  }

  // ─── Cancel ─────────────────────────────────────────

  async cancel(): Promise<SubscriptionResource> {
    return this.callCancel({ effectiveFrom: 'next_billing_period' })
  }
  async cancelNow(): Promise<SubscriptionResource> {
    return this.callCancel({ effectiveFrom: 'immediately' })
  }

  /** Undo a scheduled cancellation. */
  async stopCancelation(): Promise<SubscriptionResource> {
    return this.callUpdate({ scheduledChange: null })
  }

  // ─── Trial ──────────────────────────────────────────

  async extendTrial(date: Date): Promise<SubscriptionResource> {
    return this.callUpdate({ trialEndsAt: date.toISOString() })
  }
  async activate(): Promise<SubscriptionResource> {
    const client = await paddle()
    const fn = client.subscriptions['activate']
    if (!fn) throw new Error('[RudderJS Cashier] Paddle SDK has no `subscriptions.activate` method.')
    const updated = await fn.call(client.subscriptions, this.record.paddleId) as Record<string, unknown>
    return await this.refresh(updated)
  }

  // ─── Payment / invoice ──────────────────────────────

  async lastPayment(): Promise<TransactionResource | null> {
    const Transaction = await Cashier.transactionModel()
    const records = await Transaction
      .where('paddleSubscriptionId', this.record.paddleId)
      .orderBy('billedAt', 'DESC')
      .limit(1)
      .get() as unknown as TransactionRecord[]
    return records[0] ? new TransactionResource(records[0]) : null
  }

  /**
   * Upcoming payment (date + amount). Reads from Paddle (next_billed_at on
   * the live subscription) — DB doesn't have a column for it.
   */
  async nextPayment(): Promise<{ date: Date; amount: string; currency: string } | null> {
    const client = await paddle()
    const fn = client.subscriptions['get']
    if (!fn) throw new Error('[RudderJS Cashier] Paddle SDK has no `subscriptions.get` method.')
    const live = await fn.call(client.subscriptions, this.record.paddleId) as { nextBilledAt?: string; nextTransaction?: { details?: { totals?: { total: string; currencyCode: string } } } }
    const date = live.nextBilledAt ? new Date(live.nextBilledAt) : null
    const total = live.nextTransaction?.details?.totals?.total
    const currency = live.nextTransaction?.details?.totals?.currencyCode
    if (!date || !total || !currency) return null
    return { date, amount: total, currency }
  }

  /** Payment-method update URL — Paddle's hosted update page. */
  async redirectToUpdatePaymentMethod(): Promise<string> {
    const client = await paddle()
    const fn = client.subscriptions['get']
    if (!fn) throw new Error('[RudderJS Cashier] Paddle SDK has no `subscriptions.get` method.')
    const live = await fn.call(client.subscriptions, this.record.paddleId) as { managementUrls?: { updatePaymentMethod?: string } }
    const url = live.managementUrls?.updatePaymentMethod
    if (!url) throw new Error('[RudderJS Cashier] Paddle did not return an updatePaymentMethod URL.')
    return url
  }

  // ─── Internals ──────────────────────────────────────

  private async itemsForUpdate(): Promise<Array<{ priceId: string; quantity: number }>> {
    const items = await this.items()
    return items.map((i) => ({ priceId: i.priceId, quantity: i.quantity }))
  }

  private async callUpdate(payload: Record<string, unknown>): Promise<SubscriptionResource> {
    const client = await paddle()
    const fn = client.subscriptions['update']
    if (!fn) throw new Error('[RudderJS Cashier] Paddle SDK has no `subscriptions.update` method.')
    const updated = await fn.call(client.subscriptions, this.record.paddleId, this.applyKnobs(payload)) as Record<string, unknown>
    return await this.refresh(updated)
  }

  private async callPause(payload: Record<string, unknown>): Promise<SubscriptionResource> {
    const client = await paddle()
    const fn = client.subscriptions['pause']
    if (!fn) throw new Error('[RudderJS Cashier] Paddle SDK has no `subscriptions.pause` method.')
    const updated = await fn.call(client.subscriptions, this.record.paddleId, payload) as Record<string, unknown>
    return await this.refresh(updated)
  }

  private async callCancel(payload: Record<string, unknown>): Promise<SubscriptionResource> {
    const client = await paddle()
    const fn = client.subscriptions['cancel']
    if (!fn) throw new Error('[RudderJS Cashier] Paddle SDK has no `subscriptions.cancel` method.')
    const updated = await fn.call(client.subscriptions, this.record.paddleId, payload) as Record<string, unknown>
    return await this.refresh(updated)
  }

  private applyKnobs(payload: Record<string, unknown>): Record<string, unknown> {
    const out = { ...payload }
    if (!this._bill) out['prorationBillingMode'] = 'do_not_bill'
    else if (!this._prorate) out['prorationBillingMode'] = 'full_next_billing_period'
    // Reset knobs after consuming
    this._prorate = true
    this._bill    = true
    return out
  }

  private async refresh(_paddlePayload: Record<string, unknown>): Promise<SubscriptionResource> {
    // The webhook handler is the source of truth — we re-read from DB rather
    // than trying to derive every column from the SDK response.
    const Subscription = await Cashier.subscriptionModel()
    const fresh = await Subscription.where('paddleId', this.record.paddleId).first() as unknown as SubscriptionRecord | null
    return new SubscriptionResource(fresh ?? this.record)
  }

  private async materializeTransaction(paddlePayload: { id: string }): Promise<TransactionResource> {
    const Transaction = await Cashier.transactionModel()
    const existing = await Transaction.where('paddleId', paddlePayload.id).first() as unknown as TransactionRecord | null
    if (existing) return new TransactionResource(existing)
    // Webhook hasn't arrived yet — return a minimal stub so callers have a handle.
    return new TransactionResource({
      id:                   '',
      paddleId:             paddlePayload.id,
      paddleCustomerId:     null,
      paddleSubscriptionId: this.record.paddleId,
      billableId:           this.record.billableId,
      billableType:         this.record.billableType,
      invoiceNumber:        null,
      status:               'draft',
      total:                '0',
      tax:                  '0',
      currency:             Cashier.currency(),
      billedAt:             null,
      createdAt:            new Date(),
      updatedAt:            new Date(),
    } as TransactionRecord)
  }
}
