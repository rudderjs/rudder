// Webhook entry point. Dispatched after raw-body capture + signature verify.
//
// Flow per event:
//   1. dispatch(WebhookReceived)
//   2. idempotency check (skip if duplicate)
//   3. switch on event_type → upsert DB row → dispatch typed event
//   4. dispatch(WebhookHandled)
//   5. respond 200
//
// Returns 500 on any unhandled exception so Paddle retries.

import { dispatch } from '@rudderjs/core'
import { Cashier } from '../Cashier.js'
import { markProcessed } from './idempotency.js'
import { syncSubscriptionItems } from './items.js'
import {
  fromCustomerUpdated,
  fromSubscriptionEvent,
  fromSubscriptionPaused,
  fromSubscriptionCanceled,
  fromTransactionEvent,
} from './transformers.js'
import {
  WebhookReceived,
  WebhookHandled,
  CustomerUpdated,
  TransactionCompleted,
  TransactionUpdated,
  SubscriptionCreated,
  SubscriptionUpdated,
  SubscriptionPaused,
  SubscriptionCanceled,
} from './events.js'
import type {
  CustomerRecord,
  SubscriptionRecord,
  TransactionRecord,
} from '../contracts.js'

type Json = Record<string, unknown>
type Req  = { raw?: { __rjs_paddle_payload?: Json }; body?: unknown }
type Res  = { status(c: number): Res; json(b: unknown): unknown; send?(b?: unknown): unknown }

export async function handlePaddleWebhook(req: Req, res: Res): Promise<void> {
  const payload = (req.raw?.__rjs_paddle_payload ?? req.body ?? {}) as Json
  const eventType = typeof payload['event_type'] === 'string' ? payload['event_type'] : 'unknown'
  const eventId   = typeof payload['event_id']   === 'string' ? payload['event_id']   : ''

  await dispatch(new WebhookReceived(eventType, payload))

  // Idempotency — skip duplicates but still 200 so Paddle stops retrying.
  if (eventId) {
    const fresh = await markProcessed(eventId, eventType)
    if (!fresh) {
      await dispatch(new WebhookHandled(eventType, payload))
      res.status(200).json({ ok: true, duplicate: true })
      return
    }
  }

  try {
    switch (eventType) {
      case 'customer.updated':
        await handleCustomerUpdated(payload)
        break
      case 'transaction.completed':
        await handleTransaction(payload, /* completed */ true)
        break
      case 'transaction.updated':
        await handleTransaction(payload, false)
        break
      case 'subscription.created':
        await handleSubscriptionCreated(payload)
        break
      case 'subscription.updated':
        await handleSubscriptionUpdated(payload)
        break
      case 'subscription.paused':
        await handleSubscriptionPaused(payload)
        break
      case 'subscription.canceled':
        await handleSubscriptionCanceled(payload)
        break
      default:
        // Unknown event types are accepted (200) so Paddle doesn't retry.
        // Listeners on `WebhookReceived` can pick them up.
        break
    }

    await dispatch(new WebhookHandled(eventType, payload))
    res.status(200).json({ ok: true })
  } catch (err) {
    // Surface 500 → Paddle retries; the failure is logged by the framework's
    // exception handler since we re-throw after writing the response.
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}

// ─── Handlers ─────────────────────────────────────────────

async function handleCustomerUpdated(payload: Json): Promise<void> {
  const frag = fromCustomerUpdated(payload)
  if (!frag) return

  const Customer = await Cashier.customerModel()
  const existing = await Customer.where('paddleId', frag.paddleId).first() as unknown as CustomerRecord | null
  if (!existing) return  // Paddle-only customer — we have no billable for it yet.

  await Customer.update((existing as { id: string }).id, {
    name:  frag.name  ?? existing.name,
    email: frag.email ?? existing.email,
  } as Record<string, unknown>)

  const updated = await Customer.where('id', (existing as { id: string }).id).first() as unknown as CustomerRecord
  await dispatch(new CustomerUpdated(updated))
}

async function handleTransaction(payload: Json, completed: boolean): Promise<void> {
  const frag = fromTransactionEvent(payload)
  if (!frag) return

  const Transaction = await Cashier.transactionModel()
  const Customer    = await Cashier.customerModel()

  // Resolve billable via paddle_customer_id
  let billableId   = ''
  let billableType = Cashier.billableTypeName()
  if (frag.paddleCustomerId) {
    const cust = await Customer.where('paddleId', frag.paddleCustomerId).first() as unknown as CustomerRecord | null
    if (cust) {
      billableId   = cust.billableId
      billableType = cust.billableType
    }
  }

  const existing = await Transaction.where('paddleId', frag.paddleId).first() as unknown as TransactionRecord | null
  let record: TransactionRecord
  if (existing) {
    await Transaction.update((existing as { id: string }).id, {
      paddleCustomerId:     frag.paddleCustomerId,
      paddleSubscriptionId: frag.paddleSubscriptionId,
      invoiceNumber:        frag.invoiceNumber,
      status:               frag.status,
      total:                frag.total,
      tax:                  frag.tax,
      currency:             frag.currency,
      billedAt:             frag.billedAt,
    } as Record<string, unknown>)
    record = await Transaction.where('id', (existing as { id: string }).id).first() as unknown as TransactionRecord
  } else {
    record = await Transaction.create({
      paddleId:             frag.paddleId,
      paddleCustomerId:     frag.paddleCustomerId,
      paddleSubscriptionId: frag.paddleSubscriptionId,
      billableId,
      billableType,
      invoiceNumber:        frag.invoiceNumber,
      status:               frag.status,
      total:                frag.total,
      tax:                  frag.tax,
      currency:             frag.currency,
      billedAt:             frag.billedAt,
    } as Record<string, unknown>) as unknown as TransactionRecord
  }

  await dispatch(completed ? new TransactionCompleted(record) : new TransactionUpdated(record))
}

async function upsertSubscription(payload: Json): Promise<{ record: SubscriptionRecord; created: boolean } | null> {
  const frag = fromSubscriptionEvent(payload)
  if (!frag) return null

  const Subscription = await Cashier.subscriptionModel()
  const Customer     = await Cashier.customerModel()

  // Resolve billable via paddle customer_id
  let billableId   = ''
  let billableType = Cashier.billableTypeName()
  if (frag.paddleCustomerId) {
    const cust = await Customer.where('paddleId', frag.paddleCustomerId).first() as unknown as CustomerRecord | null
    if (cust) {
      billableId   = cust.billableId
      billableType = cust.billableType
    }
  }

  const existing = await Subscription.where('paddleId', frag.paddleId).first() as unknown as SubscriptionRecord | null

  if (existing) {
    await Subscription.update((existing as { id: string }).id, {
      paddleStatus:    frag.paddleStatus,
      paddleProductId: frag.paddleProductId,
      trialEndsAt:     frag.trialEndsAt,
      pausedAt:        frag.pausedAt,
      endsAt:          frag.endsAt,
    } as Record<string, unknown>)
    const updated = await Subscription.where('id', (existing as { id: string }).id).first() as unknown as SubscriptionRecord
    await syncSubscriptionItems((updated as { id: string }).id, frag.items)
    return { record: updated, created: false }
  }

  const created = await Subscription.create({
    billableId,
    billableType,
    type:            'default',
    paddleId:        frag.paddleId,
    paddleStatus:    frag.paddleStatus,
    paddleProductId: frag.paddleProductId,
    trialEndsAt:     frag.trialEndsAt,
    pausedAt:        frag.pausedAt,
    endsAt:          frag.endsAt,
  } as Record<string, unknown>) as unknown as SubscriptionRecord
  await syncSubscriptionItems((created as { id: string }).id, frag.items)
  return { record: created, created: true }
}

async function handleSubscriptionCreated(payload: Json): Promise<void> {
  const result = await upsertSubscription(payload)
  if (!result) return
  await dispatch(new SubscriptionCreated(result.record))
}

async function handleSubscriptionUpdated(payload: Json): Promise<void> {
  const result = await upsertSubscription(payload)
  if (!result) return
  await dispatch(new SubscriptionUpdated(result.record))
}

async function handleSubscriptionPaused(payload: Json): Promise<void> {
  const enriched = { ...payload, data: { ...(payload['data'] as Json) } }
  const frag = fromSubscriptionPaused(enriched)
  if (!frag) return
  // Re-run upsert with the paused fragment merged into payload
  const merged: Json = { ...payload, data: { ...(payload['data'] as Json), status: 'paused' } }
  const result = await upsertSubscription(merged)
  if (!result) return
  // Stamp pausedAt if upsertSubscription didn't pick it up from scheduled_change.
  // Re-read after the write so the dispatched event reflects the persisted row
  // (server-set updatedAt etc.) rather than an in-memory patch.
  if (frag.pausedAt && !result.record.pausedAt) {
    const Subscription = await Cashier.subscriptionModel()
    const id = (result.record as { id: string }).id
    await Subscription.update(id, { pausedAt: frag.pausedAt } as Record<string, unknown>)
    const refreshed = await Subscription.where('id', id).first() as unknown as SubscriptionRecord | null
    if (refreshed) result.record = refreshed
  }
  await dispatch(new SubscriptionPaused(result.record))
}

async function handleSubscriptionCanceled(payload: Json): Promise<void> {
  const frag = fromSubscriptionCanceled(payload)
  if (!frag) return
  const merged: Json = { ...payload, data: { ...(payload['data'] as Json), status: 'canceled' } }
  const result = await upsertSubscription(merged)
  if (!result) return
  if (frag.endsAt && !result.record.endsAt) {
    const Subscription = await Cashier.subscriptionModel()
    const id = (result.record as { id: string }).id
    await Subscription.update(id, { endsAt: frag.endsAt } as Record<string, unknown>)
    const refreshed = await Subscription.where('id', id).first() as unknown as SubscriptionRecord | null
    if (refreshed) result.record = refreshed
  }
  await dispatch(new SubscriptionCanceled(result.record))
}
