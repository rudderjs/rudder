import { Cashier } from './Cashier.js'
import { paddle } from './paddle-client.js'
import { Checkout, normalizePrices } from './Checkout.js'
import { SubscriptionResource } from './resources/SubscriptionResource.js'
import { TransactionResource } from './resources/TransactionResource.js'
import { subscriptionHelpers, customerHelpers } from './models/helpers.js'
import type {
  CheckoutItem,
  CustomerRecord,
  SubscriptionItemRecord,
  SubscriptionRecord,
  TransactionRecord,
} from './contracts.js'

// ─── Errors ───────────────────────────────────────────────

/**
 * Thrown when a Paddle API call inside `createAsCustomer` fails for a reason
 * other than "SDK unavailable" — duplicate email (`customer_email_in_use`),
 * network, 5xx, validation, etc. Consumers catch this at the request boundary
 * (e.g. `POST /subscribe`) to surface a friendly error instead of completing
 * checkout against a local row with `paddleId = null`.
 */
export class BillablePaddleError extends Error {
  public readonly cause: unknown
  public readonly code: string | undefined

  constructor(message: string, cause: unknown, code?: string) {
    super(message)
    this.name = 'BillablePaddleError'
    this.cause = cause
    this.code = code
  }
}

/**
 * Extract Paddle's API error code from whatever envelope the SDK surfaces.
 * Checked across `.code` and `.error.code` — covers both the raw API response
 * shape and the SDK's wrapped ApiError.
 */
function paddleErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; error?: { code?: unknown } }
    if (typeof e.code === 'string') return e.code
    if (e.error && typeof e.error === 'object' && typeof e.error.code === 'string') return e.error.code
  }
  return undefined
}

/**
 * Backfill the `billableId` / `billableType` on transactions that were recorded
 * (by webhook) before this Paddle customer was linked to a local billable.
 * Matches by `paddleCustomerId` and an empty `billableId`. Best-effort: a
 * failure here must not block customer creation, so it's caught and ignored.
 */
async function linkOrphanedTransactions(
  paddleCustomerId: string,
  billableId: string,
  billableType: string,
): Promise<void> {
  try {
    const Transaction = await Cashier.transactionModel()
    const orphans = await Transaction
      .where('paddleCustomerId', paddleCustomerId)
      .where('billableId', '')
      .get() as unknown as TransactionRecord[]
    for (const tx of orphans) {
      await Transaction.update((tx as { id: string }).id, {
        billableId,
        billableType,
      } as Record<string, unknown>)
    }
  } catch {
    // Backfill is opportunistic — never fail customer creation over it.
  }
}

// ─── Types ────────────────────────────────────────────────

export interface BillableInstance {
  /** This billable's `customers.paddleId`, or `null` if not yet a Paddle customer. */
  paddleId(): Promise<string | null>
  /** Override hook — name sent to Paddle when creating a customer. */
  paddleName(): string
  /** Override hook — email sent to Paddle when creating a customer. */
  paddleEmail(): string

  customer(): Promise<CustomerRecord | null>
  asCustomer(): Promise<CustomerRecord>
  createAsCustomer(opts?: { name?: string; email?: string; trialEndsAt?: Date }): Promise<CustomerRecord>

  checkout(prices: Array<string | CheckoutItem>): Promise<Checkout>
  subscribe(prices: Array<string | CheckoutItem>, type?: string): Promise<Checkout>

  subscribed(type?: string): Promise<boolean>
  subscribedToProduct(productId: string, type?: string): Promise<boolean>
  subscribedToPrice(priceId: string, type?: string): Promise<boolean>

  onTrial(type?: string): Promise<boolean>
  onGenericTrial(): Promise<boolean>
  hasExpiredTrial(type?: string): Promise<boolean>
  trialEndsAt(type?: string): Promise<Date | null>

  subscription(type?: string): Promise<SubscriptionResource | null>
  subscriptions(): Promise<SubscriptionResource[]>
  transactions(): Promise<TransactionResource[]>
}

// ─── Mixin ────────────────────────────────────────────────

/**
 * Add Paddle billable methods to a User (or any) Model.
 *
 * @example
 *   import { Model } from '@rudderjs/orm'
 *   import { Billable } from '@rudderjs/cashier-paddle'
 *
 *   class User extends Billable(Model) { ... }
 *
 *   await user.subscribe(['pri_abc'])     // returns Checkout
 *   await user.subscribed()                // boolean
 *   const sub = await user.subscription()  // SubscriptionResource | null
 *   await sub?.cancel()
 *
 * NOTE: ORM queries return plain records, NOT Model instances. The mixin reads
 * `(this as any).id` and treats `this` as a record. The `BillableInstance`
 * interface still works for typing purposes because callers pass either an
 * actual instance (from `new User(...)`) or a record cast to `User & BillableInstance`.
 */
export function Billable<T extends abstract new (...args: any[]) => any>(
  Base: T,
): T & (new (...args: any[]) => BillableInstance) {
  abstract class _Billable extends Base {
    /** Default — subclass should override if `name` isn't a column. */
    paddleName(): string {
      return String((this as any).name ?? '')
    }

    /** Default — subclass should override if `email` isn't a column. */
    paddleEmail(): string {
      return String((this as any).email ?? '')
    }

    async paddleId(): Promise<string | null> {
      const cust = await this.customer()
      return cust?.paddleId ?? null
    }

    async customer(): Promise<CustomerRecord | null> {
      const Customer = await Cashier.customerModel()
      const id = String((this as any).id)
      const type = Cashier.billableTypeName()
      return await Customer
        .where('billableType', type)
        .where('billableId', id)
        .first() as unknown as CustomerRecord | null
    }

    async asCustomer(): Promise<CustomerRecord> {
      const existing = await this.customer()
      if (existing) return existing
      return await this.createAsCustomer()
    }

    async createAsCustomer(opts: { name?: string; email?: string; trialEndsAt?: Date } = {}): Promise<CustomerRecord> {
      const Customer = await Cashier.customerModel()
      const type = Cashier.billableTypeName()
      const id = String((this as any).id)
      const name  = opts.name  ?? this.paddleName()
      const email = opts.email ?? this.paddleEmail()

      // Step 1: try to load the Paddle SDK. A throw here means the SDK isn't
      // configured (no API key, package not installed) — that's a legitimate
      // "mock mode" used by tests and apps doing only Paddle.js checkout. Fall
      // through with `paddleId = null` so the local row still gets written.
      let client: Awaited<ReturnType<typeof paddle>> | null = null
      try {
        client = await paddle()
      } catch {
        // SDK not configured. Persist the local row with paddleId = null.
      }

      // Step 2: if the SDK loaded, create the Paddle customer. Any failure
      // here is a real API error (duplicate email, network, 5xx, etc.). DO
      // NOT swallow it — silently persisting paddleId = null causes the
      // canonical "user paid but webhook can't find them" bug.
      let paddleId: string | null = null
      if (client) {
        const fn = client.customers['create']
        if (fn) {
          try {
            const result = await fn.call(client.customers, { name, email }) as { id?: string }
            paddleId = result.id ?? null
          } catch (err) {
            const code = paddleErrorCode(err)
            throw new BillablePaddleError(
              `[RudderJS Cashier] Failed to create Paddle customer for ${email || '<no email>'}${code ? ` (${code})` : ''}.`,
              err,
              code,
            )
          }
        }
      }

      const customer = await Customer.create({
        paddleId,
        billableId:   id,
        billableType: type,
        name,
        email,
        trialEndsAt:  opts.trialEndsAt ?? null,
      } as Record<string, unknown>) as unknown as CustomerRecord

      // A transaction webhook can land before this billable is linked to its
      // Paddle customer (webhook racing the local row write, or an imported
      // dashboard customer). Those rows were written with an empty billableId
      // and would be invisible to `transactions()`. Now that we know the
      // paddleId → billable mapping, claim them.
      if (paddleId) await linkOrphanedTransactions(paddleId, id, type)

      return customer
    }

    // ── Checkout ─────────────────────────────────────

    async checkout(prices: Array<string | CheckoutItem>): Promise<Checkout> {
      const checkout = new Checkout({ items: normalizePrices(prices) })
      const cust = await this.customer()
      if (cust?.paddleId) checkout.customer(cust.paddleId)
      else if (this.paddleEmail()) checkout.customerEmail(this.paddleEmail())
      return checkout
    }

    async subscribe(prices: Array<string | CheckoutItem>, _type = 'default'): Promise<Checkout> {
      // Cashier's `subscribe()` is a checkout for a recurring price. Paddle
      // distinguishes one-off vs recurring at the price level, not checkout
      // level — so this is essentially a checkout with a known type tag.
      const checkout = await this.checkout(prices)
      checkout.customData({ subscriptionType: _type })
      return checkout
    }

    // ── Subscription queries ─────────────────────────

    async subscribed(type = 'default'): Promise<boolean> {
      const sub = await this.subscription(type)
      return sub?.valid() ?? false
    }

    async subscribedToProduct(productId: string, type = 'default'): Promise<boolean> {
      const sub = await this.subscription(type)
      if (!sub?.valid()) return false
      // Compare against `paddleProductId` first; fall back to scanning items.
      if (sub.record.paddleProductId === productId) return true
      const items = await sub.items()
      return items.some((i) => i.productId === productId)
    }

    async subscribedToPrice(priceId: string, type = 'default'): Promise<boolean> {
      const sub = await this.subscription(type)
      if (!sub?.valid()) return false
      const items = await sub.items()
      return items.some((i: SubscriptionItemRecord) => i.priceId === priceId)
    }

    // ── Trial queries ────────────────────────────────

    async onTrial(type = 'default'): Promise<boolean> {
      const sub = await this.subscription(type)
      if (sub) return subscriptionHelpers.onTrial(sub.record)
      return await this.onGenericTrial()
    }

    async onGenericTrial(): Promise<boolean> {
      const cust = await this.customer()
      return cust ? customerHelpers.onGenericTrial(cust) : false
    }

    async hasExpiredTrial(type = 'default'): Promise<boolean> {
      const sub = await this.subscription(type)
      if (sub) return subscriptionHelpers.hasExpiredTrial(sub.record)
      const cust = await this.customer()
      return cust ? customerHelpers.hasExpiredGenericTrial(cust) : false
    }

    async trialEndsAt(type = 'default'): Promise<Date | null> {
      const sub = await this.subscription(type)
      if (sub) return sub.record.trialEndsAt
      const cust = await this.customer()
      return cust?.trialEndsAt ?? null
    }

    // ── Subscription accessors ───────────────────────

    async subscription(type = 'default'): Promise<SubscriptionResource | null> {
      const Subscription = await Cashier.subscriptionModel()
      const id = String((this as any).id)
      const billableType = Cashier.billableTypeName()
      const record = await Subscription
        .where('billableType', billableType)
        .where('billableId', id)
        .where('type', type)
        .orderBy('createdAt', 'DESC')
        .first() as unknown as SubscriptionRecord | null
      return record ? new SubscriptionResource(record) : null
    }

    async subscriptions(): Promise<SubscriptionResource[]> {
      const Subscription = await Cashier.subscriptionModel()
      const id = String((this as any).id)
      const billableType = Cashier.billableTypeName()
      const records = await Subscription
        .where('billableType', billableType)
        .where('billableId', id)
        .orderBy('createdAt', 'DESC')
        .get() as unknown as SubscriptionRecord[]
      return records.map((r) => new SubscriptionResource(r))
    }

    async transactions(): Promise<TransactionResource[]> {
      const Transaction = await Cashier.transactionModel()
      const id = String((this as any).id)
      const billableType = Cashier.billableTypeName()
      const records = await Transaction
        .where('billableType', billableType)
        .where('billableId', id)
        .orderBy('billedAt', 'DESC')
        .get() as unknown as TransactionRecord[]
      return records.map((r) => new TransactionResource(r))
    }
  }

  return _Billable as unknown as T & (new (...args: any[]) => BillableInstance)
}
