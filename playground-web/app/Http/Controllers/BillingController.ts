import { Controller, Get, Post } from '@rudderjs/router'
import { Cashier, Checkout, type SubscriptionRecord } from '@rudderjs/cashier-paddle'
import { auth } from '@rudderjs/auth'
import { config } from '@rudderjs/core'
import type { CashierConfig } from '@rudderjs/cashier-paddle'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import { User } from '../../Models/User.js'

interface PriceCard {
  id:          string
  label:       string
  description: string
}

const DEMO_PRICES: PriceCard[] = [
  { id: 'pri_demo_basic', label: 'Basic',  description: 'For hobby projects — $9/mo' },
  { id: 'pri_demo_pro',   label: 'Pro',    description: 'For teams — $29/mo' },
  { id: 'pri_demo_max',   label: 'Max',    description: 'For unlimited workspaces — $99/mo' },
]

@Controller('/api/billing')
export class BillingController {
  /** Build a checkout for the signed-in user, return Paddle.js options. */
  @Post('/checkout')
  async createCheckout(req: AppRequest, res: AppResponse): Promise<void> {
    const userRecord = await auth().user() as { id: string; email: string; name: string } | null
    if (!userRecord) { res.status(401).json({ error: 'unauthenticated' }); return }

    const body = (req.body ?? {}) as { priceId?: string }
    if (!body.priceId) { res.status(400).json({ error: 'missing_price_id' }); return }

    // Materialize a User wrapper so we can use the Billable mixin.
    const user = Object.assign(new User(), userRecord)
    const checkout = await user.checkout([body.priceId])
    checkout.returnTo('/demos/billing')

    res.json({ options: checkout.options() })
  }

  /** List the signed-in user's subscriptions in a UI-friendly shape. */
  @Get('/subscriptions')
  async listSubscriptions(_req: AppRequest, res: AppResponse): Promise<void> {
    const userRecord = await auth().user() as { id: string } | null
    if (!userRecord) { res.status(401).json({ error: 'unauthenticated' }); return }

    const user = Object.assign(new User(), userRecord)
    const subs = await user.subscriptions()
    res.json({ subscriptions: subs.map(rowFor) })
  }

  @Post('/subscriptions/:paddleId/pause')
  async pause(req: AppRequest, res: AppResponse): Promise<void> {
    await this.mutate(req, res, async (sub) => { await sub.pause() })
  }

  @Post('/subscriptions/:paddleId/resume')
  async resume(req: AppRequest, res: AppResponse): Promise<void> {
    await this.mutate(req, res, async (sub) => { await sub.resume() })
  }

  @Post('/subscriptions/:paddleId/cancel')
  async cancel(req: AppRequest, res: AppResponse): Promise<void> {
    await this.mutate(req, res, async (sub) => { await sub.cancel() })
  }

  // ── helpers ────────────────────────────────────────────

  private async mutate(
    req: AppRequest,
    res: AppResponse,
    op: (sub: import('@rudderjs/cashier-paddle').SubscriptionResource) => Promise<void>,
  ): Promise<void> {
    const userRecord = await auth().user() as { id: string } | null
    if (!userRecord) { res.status(401).json({ error: 'unauthenticated' }); return }

    const paddleId = (req.params as Record<string, string> | undefined)?.['paddleId']
    if (!paddleId) { res.status(400).json({ error: 'missing_paddle_id' }); return }

    const user = Object.assign(new User(), userRecord)
    const subs = await user.subscriptions()
    const target = subs.find((s) => s.record.paddleId === paddleId)
    if (!target) { res.status(404).json({ error: 'not_found' }); return }

    if (Cashier.apiKey()) {
      try {
        await op(target)
      } catch (e) {
        res.status(502).json({ error: 'paddle_call_failed', message: (e as Error).message })
        return
      }
    }
    // Re-read after the mutation (webhook is the source of truth).
    const refreshed = await user.subscriptions()
    res.json({ subscriptions: refreshed.map(rowFor) })
  }
}

// ─── Public helpers (used by routes/web.ts) ─────────────

export function billingDemoProps(mock: boolean, signedIn: boolean, subscription: SubscriptionRecord | null) {
  const cashierCfg = (() => { try { return config<CashierConfig>('cashier') } catch { return {} as CashierConfig } })()
  return {
    mock,
    clientSideToken: cashierCfg.clientSideToken ?? '',
    sandbox:         cashierCfg.sandbox ?? true,
    prices:          DEMO_PRICES,
    signedIn,
    subscription: subscription ? {
      paddleId:    subscription.paddleId,
      status:      subscription.paddleStatus,
      productId:   subscription.paddleProductId,
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      pausedAt:    subscription.pausedAt?.toISOString()    ?? null,
      endsAt:      subscription.endsAt?.toISOString()      ?? null,
    } : null,
  }
}

export function billingSubscriptionsProps(mock: boolean, subs: import('@rudderjs/cashier-paddle').SubscriptionResource[]) {
  return { mock, subscriptions: subs.map(rowFor) }
}

function rowFor(s: import('@rudderjs/cashier-paddle').SubscriptionResource) {
  return {
    paddleId:    s.record.paddleId,
    type:        s.record.type,
    status:      s.record.paddleStatus,
    productId:   s.record.paddleProductId,
    pausedAt:    s.record.pausedAt?.toISOString()    ?? null,
    endsAt:      s.record.endsAt?.toISOString()      ?? null,
    trialEndsAt: s.record.trialEndsAt?.toISOString() ?? null,
    active:      s.active(),
    paused:      s.paused(),
    canceled:    s.canceled(),
    onGrace:     s.onGracePeriod(),
  }
}

// Used by Checkout.guest in tests/scripts; ensures the import is preserved.
void Checkout
