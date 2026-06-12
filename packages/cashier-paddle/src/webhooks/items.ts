// Persist a subscription's line items to `paddle_subscription_items`.
//
// Paddle's subscription.* webhooks (and the `cashier:sync` backfill) carry the
// full item set on the subscription object. We mirror it into the local table
// so `SubscriptionResource.items()` / `.swap()` read the canonical lines rather
// than an empty set.
//
// The reconcile is upsert-by-priceId + prune-missing (Laravel Cashier's
// `updateSubscriptionItems` shape), NOT delete-all-then-insert: a transient
// failure mid-reconcile leaves the prior rows in place instead of an empty
// window, and ids stay stable for items that didn't change.

import { Cashier } from '../Cashier.js'
import type { SubscriptionItemRecord } from '../contracts.js'

export interface SubscriptionItemFragment {
  priceId:   string
  productId: string
  quantity:  number
  status:    string
}

export async function syncSubscriptionItems(
  subscriptionId: string,
  items: readonly SubscriptionItemFragment[],
): Promise<void> {
  const Item = await Cashier.subscriptionItemModel()

  const incoming = items.filter((i) => i.priceId)
  const existing = await Item.where('subscriptionId', subscriptionId).get() as unknown as SubscriptionItemRecord[]
  const byPrice  = new Map(existing.map((r) => [r.priceId, r]))

  for (const it of incoming) {
    const cur = byPrice.get(it.priceId)
    if (cur) {
      await Item.update(cur.id, {
        productId: it.productId,
        status:    it.status,
        quantity:  it.quantity,
      } as Record<string, unknown>)
    } else {
      await Item.create({
        subscriptionId,
        productId: it.productId,
        priceId:   it.priceId,
        status:    it.status,
        quantity:  it.quantity,
      } as Record<string, unknown>)
    }
  }

  // Prune items no longer present on the subscription.
  const keep = new Set(incoming.map((i) => i.priceId))
  for (const r of existing) {
    if (!keep.has(r.priceId)) await Item.delete(r.id)
  }
}
