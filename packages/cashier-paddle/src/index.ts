import { fileURLToPath } from 'node:url'
import { ServiceProvider, config } from '@rudderjs/core'

// ─── Re-exports ───────────────────────────────────────────

export { Cashier } from './Cashier.js'
export type { CashierConfig, BillableModelLike } from './Cashier.js'

export { Customer }         from './models/Customer.js'
export { Subscription }     from './models/Subscription.js'
export { SubscriptionItem } from './models/SubscriptionItem.js'
export { Transaction }      from './models/Transaction.js'
export { WebhookLog }       from './models/WebhookLog.js'

export {
  subscriptionHelpers,
  customerHelpers,
  transactionHelpers,
} from './models/helpers.js'

export {
  isSubscribed, isActive, isRecurring, onTrial, hasExpiredTrial,
  isPastDue, isPaused, onGracePeriod, onPausedGracePeriod, isCanceled, ended,
} from './state.js'

export type {
  SubscriptionStatus, TransactionStatus,
  SubscriptionRecord, SubscriptionItemRecord, CustomerRecord, TransactionRecord,
  CheckoutItem, CheckoutOptions,
} from './contracts.js'

export { Billable, BillablePaddleError } from './billable.js'
export type { BillableInstance } from './billable.js'

export { Checkout, normalizePrices } from './Checkout.js'
export type { SerializedCheckoutOptions } from './Checkout.js'

export { SubscriptionResource } from './resources/SubscriptionResource.js'
export { TransactionResource }  from './resources/TransactionResource.js'

export { paddle, resetPaddleClient, setPaddleClientForTesting } from './paddle-client.js'
export { formatAmount } from './format.js'
export { previewPrices } from './preview.js'
export type { PreviewOptions, PreviewResult, PreviewItem, PreviewAddress } from './preview.js'

// Webhooks
export {
  WebhookReceived, WebhookHandled,
  CustomerUpdated,
  TransactionCompleted, TransactionUpdated,
  SubscriptionCreated, SubscriptionUpdated, SubscriptionPaused, SubscriptionCanceled,
} from './webhooks/events.js'
export { handlePaddleWebhook } from './webhooks/handler.js'
export { markProcessed }       from './webhooks/idempotency.js'
export {
  fromCustomerUpdated,
  fromSubscriptionEvent, fromSubscriptionPaused, fromSubscriptionCanceled,
  fromTransactionEvent,
} from './webhooks/transformers.js'

// Middleware
export { captureRawBody }       from './middleware/raw-body.js'
export { verifyPaddleWebhook }  from './middleware/verify-paddle-webhook.js'

// Routes
export { registerCashierRoutes } from './routes.js'
export type { CashierRouteOptions, CashierRouteGroup } from './routes.js'

// Imports needed for the provider below
import { Cashier, type CashierConfig } from './Cashier.js'
import { Customer }         from './models/Customer.js'
import { Subscription }     from './models/Subscription.js'
import { SubscriptionItem } from './models/SubscriptionItem.js'
import { Transaction }      from './models/Transaction.js'
import { WebhookLog }       from './models/WebhookLog.js'

// ─── Service Provider ─────────────────────────────────────

/**
 * `CashierPaddleProvider` — wires Paddle billing into a RudderJS app.
 *
 * Boot order: `feature` stage (after auth + orm). Reads `config('cashier')`
 * and applies it to the static `Cashier` singleton.
 *
 * Use the `cashier()` factory below in `bootstrap/providers.ts`:
 *   import { cashier } from '@rudderjs/cashier-paddle'
 *   export default [ ...defaultProviders(), cashier(configs.cashier), ... ]
 *
 * Or rely on auto-discovery — the package's `package.json` declares
 * `rudderjs.provider = "CashierPaddleProvider"`.
 */
export class CashierPaddleProvider extends ServiceProvider {
  register(): void {
    const schemaDir = fileURLToPath(new URL(/* @vite-ignore */ '../schema', import.meta.url))
    const viewsDir  = fileURLToPath(new URL(/* @vite-ignore */ '../views', import.meta.url))

    this.publishes([
      // Schema fragment
      { from: `${schemaDir}/cashier-paddle.prisma`, to: 'prisma/schema', tag: 'cashier-schema', orm: 'prisma' as const },
      // React views — Vue/Solid land later as demand appears
      { from: `${viewsDir}/react`, to: 'app/Views/Cashier', tag: 'cashier-views-react' },
    ])
  }

  async boot(): Promise<void> {
    const cfg = (() => {
      try { return config<CashierConfig>('cashier') } catch { return {} as CashierConfig }
    })()

    // Apply config to the static singleton
    Cashier.configure(cfg)

    // Register defaults so apps don't have to call useXModel themselves
    if (!cfg.models?.customer)         Cashier.useCustomerModel(Customer)
    if (!cfg.models?.subscription)     Cashier.useSubscriptionModel(Subscription)
    if (!cfg.models?.subscriptionItem) Cashier.useSubscriptionItemModel(SubscriptionItem)
    if (!cfg.models?.transaction)      Cashier.useTransactionModel(Transaction)
    void WebhookLog  // referenced so the model is registered with the ORM registry on first use

    this.app.instance('cashier', Cashier)

    // CLI commands — register lazily so `rudder` is optional in tests
    try {
      const { rudder } = await import('@rudderjs/core')

      rudder.command('cashier:install', async () => {
        const { runInstall } = await import('./commands/install.js')
        await runInstall()
      }).description('Publish the cashier-paddle schema and views into your app.')

      rudder.command('cashier:webhook', async (args: string[]) => {
        const { runWebhook } = await import('./commands/webhook.js')
        await runWebhook(args)
      }).description('Inspect or simulate a Paddle webhook locally.')

      rudder.command('cashier:sync', async (args: string[]) => {
        const { runSync } = await import('./commands/sync.js')
        await runSync(args)
      }).description('Sync customers, subscriptions, and transactions from Paddle.')
    } catch {
      // Rudder not available — the package still works without CLI
    }
  }
}

/** Factory that returns the provider class — used in `bootstrap/providers.ts`. */
export function cashier(_cfg?: CashierConfig): typeof CashierPaddleProvider {
  // Config is read from `config('cashier')` inside `boot()` — the factory
  // signature exists only to match the conventional `eventsProvider(...)` /
  // `session(...)` shape RudderJS apps already use.
  return CashierPaddleProvider
}
