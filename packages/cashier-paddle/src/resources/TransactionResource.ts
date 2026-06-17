import { Cashier } from '../Cashier.js'
import { paddle } from '../paddle-client.js'
import { formatAmount } from '../format.js'
import { transactionHelpers } from '../models/helpers.js'
import type { TransactionRecord } from '../contracts.js'

/** Wrapper around a `paddle_transactions` row — refunds, credits, formatting. */
export class TransactionResource {
  public readonly record: TransactionRecord

  constructor(record: TransactionRecord) {
    this.record = record
  }

  // ── Status ────────────────────────────────────────────

  status():     string  { return this.record.status }
  completed():  boolean { return transactionHelpers.isCompleted(this.record) }
  paid():       boolean { return transactionHelpers.isPaid(this.record) }
  isPastDue():  boolean { return transactionHelpers.isPastDue(this.record) }

  // ── Formatted amounts ────────────────────────────────

  total(locale?: string):    string { return formatAmount(this.record.total, this.record.currency, locale) }
  tax(locale?: string):      string { return formatAmount(this.record.tax,   this.record.currency, locale) }
  subtotal(locale?: string): string {
    return formatAmount(transactionHelpers.rawSubtotal(this.record), this.record.currency, locale)
  }

  rawTotal():    string { return this.record.total }
  rawTax():      string { return this.record.tax }
  rawSubtotal(): string { return transactionHelpers.rawSubtotal(this.record) }

  currency(): string { return this.record.currency }

  // ── Actions ──────────────────────────────────────────

  /**
   * Refund a transaction. `items` array maps `priceId` → minor units to refund.
   * Empty items array = full refund.
   */
  async refund(reason: string, items: Array<{ priceId: string; amount?: string }> = []): Promise<TransactionResource> {
    const client = await paddle()
    const fn = client.transactions['createAdjustment']
      ?? (client as unknown as { adjustments?: Record<string, (...a: unknown[]) => Promise<unknown>> }).adjustments?.['create']
    if (!fn) throw new Error('[Rudder Cashier] Paddle SDK has no adjustments/refund endpoint.')

    const result = await fn.call(client, {
      action:        'refund',
      transactionId: this.record.paddleId,
      reason,
      items: items.length === 0
        ? [{ type: 'full' }]
        : items.map((i) => i.amount
            ? { type: 'partial', itemId: i.priceId, amount: i.amount }
            : { type: 'full', itemId: i.priceId }),
    }) as Record<string, unknown>

    return await this.refresh(result)
  }

  /** Credit a balance to the customer (no payment refunded). */
  async credit(reason: string, priceId: string): Promise<TransactionResource> {
    const client = await paddle()
    const fn = (client as unknown as { adjustments?: Record<string, (...a: unknown[]) => Promise<unknown>> }).adjustments?.['create']
    if (!fn) throw new Error('[Rudder Cashier] Paddle SDK has no `adjustments.create` method.')

    const result = await fn.call(client, {
      action:        'credit',
      transactionId: this.record.paddleId,
      reason,
      items: [{ type: 'full', itemId: priceId }],
    }) as Record<string, unknown>
    return await this.refresh(result)
  }

  /** Get the hosted invoice PDF URL. */
  async redirectToInvoicePdf(): Promise<string> {
    const client = await paddle()
    const fn = client.transactions['getInvoicePdf'] ?? client.transactions['invoicePdf']
    if (!fn) throw new Error('[Rudder Cashier] Paddle SDK has no transactions.getInvoicePdf method.')
    const result = await fn.call(client.transactions, this.record.paddleId) as { url?: string }
    if (!result.url) throw new Error('[Rudder Cashier] Paddle did not return an invoice PDF URL.')
    return result.url
  }

  // ── Internals ────────────────────────────────────────

  private async refresh(_paddlePayload: Record<string, unknown>): Promise<TransactionResource> {
    const Transaction = await Cashier.transactionModel()
    const fresh = await Transaction.where('paddleId', this.record.paddleId).first() as unknown as TransactionRecord | null
    return new TransactionResource(fresh ?? this.record)
  }
}
