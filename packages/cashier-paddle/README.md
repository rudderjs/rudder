# @rudderjs/cashier-paddle

Paddle billing for Rudder apps. Mix `Billable` into your `User` model and you get checkout sessions, subscription state, refunds, pricing previews, and a signed webhook receiver — backed by typed Prisma tables.

```ts
import { Model } from '@rudderjs/orm'
import { Billable } from '@rudderjs/cashier-paddle'

class User extends Billable(Model) {}

// Server: build a checkout for the signed-in user
const checkout = await user.checkout(['pri_abc']).then(c => c.returnTo('/dashboard'))

// Client: open the Paddle overlay
window.Paddle.Checkout.open(checkout.options())

// Anywhere: query state
if (await user.subscribed()) { /* … */ }
const sub = await user.subscription()
await sub?.cancel()
```

## Install

```bash
pnpm add @rudderjs/cashier-paddle @paddle/paddle-node-sdk
```

`@paddle/paddle-node-sdk` is an optional peer — checkout-only apps that never call Paddle's REST API can skip it.

```bash
pnpm rudder cashier:install        # publish schema + React views
pnpm exec prisma generate          # regenerate client
pnpm exec prisma db push           # apply the schema
```

## Configure

```ts
// config/cashier.ts
import { Env } from '@rudderjs/core'
import type { CashierConfig } from '@rudderjs/cashier-paddle'

export default {
  apiKey:          Env.get('PADDLE_API_KEY', ''),
  clientSideToken: Env.get('PADDLE_CLIENT_SIDE_TOKEN', ''),
  webhookSecret:   Env.get('PADDLE_WEBHOOK_SECRET', ''),
  sandbox:         Env.get('PADDLE_SANDBOX', 'true') === 'true',
  webhookPath:     '/paddle/webhook',
  currency:        'USD',
  currencyLocale:  'en',
} satisfies CashierConfig
```

```ts
// bootstrap/providers.ts — `defaultProviders()` auto-discovers cashier-paddle
import { defaultProviders } from '@rudderjs/core'
export default [...(await defaultProviders())]
```

## Wire the webhook + Billable model

```ts
// routes/web.ts
import { registerCashierRoutes, Cashier } from '@rudderjs/cashier-paddle'
import { User } from '../app/Models/User.js'

registerCashierRoutes(Route)         // POST /paddle/webhook
Cashier.useBillableModel(User)       // tells the webhook handler what type to record
```

If `routes/web.ts` is loaded into the `web` middleware group, exempt the webhook path from CSRF in `bootstrap/app.ts`:

```ts
m.web(CsrfMiddleware({ exclude: ['/paddle/webhook'] }))
```

## API surface

### Billable (mixin on User)

| Method                                        | Returns                              |
|-----------------------------------------------|--------------------------------------|
| `checkout(prices)`                            | `Promise<Checkout>`                  |
| `subscribe(prices, type?)`                    | `Promise<Checkout>`                  |
| `subscribed(type?)`                           | `Promise<boolean>`                   |
| `subscribedToProduct(id, type?)`              | `Promise<boolean>`                   |
| `subscribedToPrice(id, type?)`                | `Promise<boolean>`                   |
| `onTrial(type?)` / `onGenericTrial()`         | `Promise<boolean>`                   |
| `hasExpiredTrial(type?)`                      | `Promise<boolean>`                   |
| `trialEndsAt(type?)`                          | `Promise<Date \| null>`              |
| `subscription(type?)`                         | `Promise<SubscriptionResource \| null>` |
| `subscriptions()`                             | `Promise<SubscriptionResource[]>`    |
| `transactions()`                              | `Promise<TransactionResource[]>`     |
| `customer()` / `asCustomer()`                 | `Promise<CustomerRecord \| null>`    |
| `createAsCustomer(opts?)`                     | `Promise<CustomerRecord>`            |
| `paddleId()` / `paddleName()` / `paddleEmail()` | overrides                          |

### SubscriptionResource

State checks: `active() · recurring() · onTrial() · expiredTrial() · pastDue() · paused() · onPausedGracePeriod() · canceled() · onGracePeriod() · ended() · valid()`

Mutations: `swap(prices) · swapAndInvoice(prices) · incrementQuantity(n?, priceId?) · decrementQuantity(n?, priceId?) · updateQuantity(n, priceId?) · charge(items) · chargeAndInvoice(items) · pause() · pauseNow() · pauseUntil(date) · pauseNowUntil(date) · resume() · cancel() · cancelNow() · stopCancelation() · extendTrial(date) · activate() · redirectToUpdatePaymentMethod()`

Reads: `lastPayment() · nextPayment() · items()`

Knobs: `noProrate() · doNotBill()` (chainable, apply to next mutation)

### TransactionResource

`refund(reason, items?) · credit(reason, priceId) · redirectToInvoicePdf()`
Formatted amounts: `total() · tax() · subtotal()` (locale-aware)
Raw amounts: `rawTotal() · rawTax() · rawSubtotal()` (string, minor units)

### Checkout

`Checkout.guest(prices)` for guest sessions. Builders: `returnTo · customData · customer · customerEmail · discount · addItem`. Serialize via `.options()`.

### previewPrices

```ts
const result = await previewPrices(['pri_abc'], {
  address: { countryCode: 'BE', postalCode: '1000' },
})
result.items[0].total   // → "€19.99"
```

### Webhooks

`registerCashierRoutes(Route)` mounts `POST /paddle/webhook`. Listen via `eventsProvider`:

```ts
import {
  WebhookReceived, WebhookHandled,
  CustomerUpdated,
  TransactionCompleted, TransactionUpdated,
  SubscriptionCreated, SubscriptionUpdated, SubscriptionPaused, SubscriptionCanceled,
} from '@rudderjs/cashier-paddle'

// bootstrap/providers.ts
eventsProvider({
  [SubscriptionUpdated.name]: [SyncMyAuthorization],
  [TransactionCompleted.name]: [SendReceiptEmail],
})
```

## React components

```tsx
import { PaddleScript, CheckoutButton, InlineCheckout } from '@rudderjs/cashier-paddle/views/react/...'

<PaddleScript token={config.clientSideToken} sandbox />

<CheckoutButton checkout={await fetch('/api/checkout').then(r => r.json())}>
  Buy Pro
</CheckoutButton>

<InlineCheckout checkout={...} height={520} />
```

## Past-due / grace-period semantics

`subscribed()` returns true for: `active`, `trialing`, paused-on-grace, canceled-on-grace.
Past-due is excluded by default — call `Cashier.keepPastDueSubscriptionsActive()` to flip it.

## See also

- Playground demo at `/demos/billing` — full end-to-end example with checkout button, manage UI, and webhook plumbing.
- `pnpm rudder cashier:webhook simulate <event_type>` — replay a fixture from `tests/fixtures/paddle/`.
