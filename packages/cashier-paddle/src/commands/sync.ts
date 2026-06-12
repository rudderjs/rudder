// `cashier:sync [--since <iso-date>]` — backfill from Paddle.
//
// Pages through Paddle's customers/subscriptions/transactions and upserts
// matching rows in the local DB. Use after restoring backups, importing an
// existing Paddle account, or after webhook downtime.

import { Cashier } from '../Cashier.js'
import { paddle } from '../paddle-client.js'
import {
  fromSubscriptionEvent,
  fromTransactionEvent,
  fromCustomerUpdated,
} from '../webhooks/transformers.js'
import { syncSubscriptionItems } from '../webhooks/items.js'

interface PaddleListResult<T> {
  data: T[]
  meta?: { pagination?: { hasMore?: boolean; nextCursor?: string } }
}

export async function runSync(args: string[]): Promise<void> {
  const sinceArg = parseSince(args)

  const client = await paddle()

  // ─── Customers ────────────────────────────────────────
  const customers = await pageThrough(client.customers, sinceArg, async (rec) => {
    const frag = fromCustomerUpdated({ data: rec as Record<string, unknown> })
    if (!frag) return
    const Customer = await Cashier.customerModel()
    const existing = await Customer.where('paddleId', frag.paddleId).first() as { id: string } | null
    if (!existing) return
    await Customer.update(existing.id, {
      name:  frag.name,
      email: frag.email,
    } as Record<string, unknown>)
  })

  // ─── Subscriptions ────────────────────────────────────
  const subscriptions = await pageThrough(client.subscriptions, sinceArg, async (rec) => {
    const frag = fromSubscriptionEvent({ data: rec as Record<string, unknown> })
    if (!frag) return
    const Subscription = await Cashier.subscriptionModel()
    const existing = await Subscription.where('paddleId', frag.paddleId).first() as { id: string } | null
    if (existing) {
      await Subscription.update(existing.id, {
        paddleStatus:    frag.paddleStatus,
        paddleProductId: frag.paddleProductId,
        trialEndsAt:     frag.trialEndsAt,
        pausedAt:        frag.pausedAt,
        endsAt:          frag.endsAt,
      } as Record<string, unknown>)
      await syncSubscriptionItems(existing.id, frag.items)
    }
  })

  // ─── Transactions ─────────────────────────────────────
  const transactions = await pageThrough(client.transactions, sinceArg, async (rec) => {
    const frag = fromTransactionEvent({ data: rec as Record<string, unknown> })
    if (!frag) return
    const Transaction = await Cashier.transactionModel()
    const existing = await Transaction.where('paddleId', frag.paddleId).first() as { id: string } | null
    if (existing) {
      await Transaction.update(existing.id, {
        status:   frag.status,
        total:    frag.total,
        tax:      frag.tax,
        currency: frag.currency,
        billedAt: frag.billedAt,
      } as Record<string, unknown>)
    }
  })

  console.log(`  Synced from Paddle:`)
  console.log(`    Customers:     ${customers}`)
  console.log(`    Subscriptions: ${subscriptions}`)
  console.log(`    Transactions:  ${transactions}`)
}

function parseSince(args: string[]): string | undefined {
  const idx = args.indexOf('--since')
  if (idx === -1) return undefined
  return args[idx + 1]
}

async function pageThrough(
  resource: Record<string, (...a: unknown[]) => Promise<unknown>>,
  since: string | undefined,
  process: (rec: unknown) => Promise<void>,
): Promise<number> {
  const list = resource['list']
  if (!list) return 0

  let count = 0
  let cursor: string | undefined
  // Hard cap to avoid runaway loops if Paddle returns stale `hasMore` flags.
  for (let pages = 0; pages < 100; pages++) {
    const opts: Record<string, unknown> = { perPage: 200 }
    if (cursor) opts['after'] = cursor
    if (since)  opts['updatedAt'] = { gte: since }

    const result = await list.call(resource, opts) as PaddleListResult<unknown>
    for (const rec of result.data) {
      await process(rec)
      count++
    }

    const more = result.meta?.pagination?.hasMore
    cursor     = result.meta?.pagination?.nextCursor
    if (!more || !cursor) break
  }
  return count
}
