# Cashier Paddle

Paddle billing for Rudder. `Billable` mixin for user models, subscription state machine, signed webhook receiver, checkout sessions, single charges, refunds, pricing previews, and drop-in React components.

`@rudderjs/cashier-paddle` integrates with [Paddle Billing](https://www.paddle.com) (Paddle 2.x) — the new Paddle, not Paddle Classic. Before you dig in, skim Paddle's [concept guides](https://developer.paddle.com/concepts/overview) and [API reference](https://developer.paddle.com/api-reference/overview).

## Installation

```bash
pnpm add @rudderjs/cashier-paddle @rudderjs/auth @rudderjs/orm-prisma @paddle/paddle-node-sdk
```

`@paddle/paddle-node-sdk` is an optional peer — only required for server-side Paddle calls (subscriptions, refunds, price previews). Apps that only do checkout (Paddle.js in the browser) can skip it.

Publish the schema fragment and React components, then push the schema:

```bash
pnpm rudder cashier:install
pnpm exec prisma generate
pnpm exec prisma db push
```

`cashier:install` writes `prisma/schema/cashier-paddle.prisma` (5 tables: `paddleCustomers`, `paddleSubscriptions`, `paddleSubscriptionItems`, `paddleTransactions`, `paddleWebhookLogs`) and copies `app/Views/Components/Cashier/{CheckoutButton,InlineCheckout,PaddleScript}.tsx` into your app.

> [!WARNING]
> To make sure Cashier handles all Paddle events, finish [setting up the webhook receiver](#handling-webhooks) before going live.

### Paddle Sandbox

For local and staging, [register a Paddle Sandbox account](https://sandbox-login.paddle.com/signup) — the sandbox lets you test the full flow without real charges using Paddle's [test card numbers](https://developer.paddle.com/concepts/payment-methods/credit-debit-card#test-payment-method).

```ini
PADDLE_SANDBOX=true
```

Flip to `false` in production after Paddle approves your domain.

## Configuration

```ts
// config/cashier.ts
import { Env } from '@rudderjs/core'
import type { CashierConfig } from '@rudderjs/cashier-paddle'

export default {
  apiKey:          Env.get('PADDLE_API_KEY', ''),
  clientSideToken: Env.get('PADDLE_CLIENT_SIDE_TOKEN', ''),
  webhookSecret:   Env.get('PADDLE_WEBHOOK_SECRET', ''),
  sandbox:         Env.get('PADDLE_SANDBOX', 'true') === 'true',
} satisfies CashierConfig
```

```ini
# .env
PADDLE_CLIENT_SIDE_TOKEN=your-paddle-client-side-token
PADDLE_API_KEY=your-paddle-api-key
PADDLE_WEBHOOK_SECRET=your-paddle-webhook-secret
PADDLE_SANDBOX=true
```

Values come from your Paddle dashboard. The webhook secret is generated when you create a notification destination.

### Billable model

Mix `Billable` into the model that owns subscriptions — usually `User`, but can be any model:

```ts
// app/Models/User.ts
import { Model } from '@rudderjs/orm'
import { Billable } from '@rudderjs/cashier-paddle'

export class User extends Billable(Model) {
  static table = 'user'
}
```

```ts
// routes/web.ts (or AppServiceProvider.boot())
import { Cashier } from '@rudderjs/cashier-paddle'
import { User } from '../app/Models/User.js'

Cashier.useBillableModel(User)
```

`useBillableModel` is required — webhook handlers materialize the User from `customerId` lookups and need the model class.

### Routes

```ts
// routes/web.ts
import { registerCashierRoutes } from '@rudderjs/cashier-paddle'

registerCashierRoutes(Route)
```

This registers `POST /paddle/webhook` (with raw-body capture + signature verification middleware pre-mounted) and any helper routes you opt into.

> [!WARNING]
> The webhook bypasses CSRF because Paddle isn't a browser. If you put `CsrfMiddleware()` on the `web` group, exclude `/paddle/webhook` explicitly:
>
> ```ts
> .withMiddleware((m) => {
>   m.web(CsrfMiddleware({ exclude: ['/paddle/webhook'] }).toHandler())
> })
> ```

### Paddle.js

Paddle's checkout UI is rendered by their JavaScript SDK loaded from a CDN. Drop the included `<PaddleScript />` component into your app shell:

```tsx
// app/Views/Layout.tsx (or wherever your <head> is)
import { PaddleScript } from '@/Views/Components/Cashier/PaddleScript'

<head>
  {/* ... */}
  <PaddleScript />
</head>
```

The component reads `clientSideToken` from your config and initializes Paddle with sandbox mode when applicable.

### Currency formatting

`formatAmount(minorUnits, currency, locale?)` uses `Intl.NumberFormat` for display:

```ts
import { formatAmount } from '@rudderjs/cashier-paddle'

formatAmount('1999', 'USD')        // → "$19.99"
formatAmount('1999', 'EUR', 'de')  // → "19,99 €"
```

### Overriding default models

In v1, only the `Billable` model is configurable. The framework Models — `Customer`, `Subscription`, `SubscriptionItem`, `Transaction`, `WebhookLog` — are exported but you don't need to subclass them in normal use. The schema columns `billable_id` + `billable_type` are reserved for future polymorphic billing.

## Quickstart

### Selling a one-off product

```ts
// app/Http/Controllers/CheckoutController.ts
import { Controller } from '@rudderjs/core'

export default class CheckoutController extends Controller {
  async buy(req) {
    const checkout = await req.user.checkout(['pri_deluxe_album'])
    checkout.returnTo('/dashboard')
    return view('buy', { options: checkout.options() })
  }
}
```

```tsx
// app/Views/buy.tsx
import { CheckoutButton } from '@/Views/Components/Cashier/CheckoutButton'

export default function Buy({ options }) {
  return (
    <CheckoutButton options={options} className="px-8 py-4">
      Buy Album
    </CheckoutButton>
  )
}
```

The `checkout()` method auto-creates a Paddle customer record on first call and links it to the user. After payment, Paddle posts a `transaction.completed` webhook — the handler (already running) records the transaction and fires the `cashier.transaction.completed` event.

### Selling a subscription

```ts
async subscribe(req) {
  const checkout = await req.user.subscribe(['price_basic_monthly'], 'default')
  checkout.returnTo('/dashboard')
  return view('subscribe', { options: checkout.options() })
}
```

The second argument is the **subscription type** — a stable internal name (`default`, `swimming`, `pro_seat`) so a single user can hold multiple subscriptions. Don't show this to users; never rename it after creating subscriptions.

After checkout completes, the `subscription_created` webhook fires and the row lands in `paddle_subscriptions`. From then on:

```ts
if (await req.user.subscribed())                         { /* user has an active sub */ }
if (await req.user.subscribedToProduct('pro_basic'))     { /* on the Basic product */ }
if (await req.user.subscribedToPrice('price_basic_yearly')) { /* on the yearly price */ }
```

A "subscribed" middleware:

```ts
import { defineMiddleware } from '@rudderjs/middleware'

export const Subscribed = defineMiddleware(async (req, _res, next) => {
  if (!await req.user?.subscribed()) return Response.redirect('/billing')
  return next()
})
```

## Checkout Sessions

Most billing operations go through Paddle's [Checkout Overlay](https://developer.paddle.com/build/checkout/build-overlay-checkout) or [Inline Checkout](https://developer.paddle.com/build/checkout/build-branded-inline-checkout). Both use the same checkout session — the only difference is how it renders.

### Overlay checkout

```ts
const checkout = await req.user.checkout(['pri_34567'])
checkout.returnTo('/dashboard')
return view('billing', { options: checkout.options() })
```

```tsx
import { CheckoutButton } from '@/Views/Components/Cashier/CheckoutButton'

<CheckoutButton options={options} className="px-8 py-4" data-theme="light">
  Subscribe
</CheckoutButton>
```

The component takes any of Paddle's [HTML data attributes](https://developer.paddle.com/paddlejs/html-data-attributes) — `data-theme`, `data-allow-discount-removal`, etc.

### Inline checkout

```tsx
import { InlineCheckout } from '@/Views/Components/Cashier/InlineCheckout'

<InlineCheckout options={options} className="w-full" height={500} />
```

The inline component embeds the checkout iframe directly. Customization is limited to what Paddle's iframe exposes — see Paddle's [inline checkout guide](https://developer.paddle.com/build/checkout/build-branded-inline-checkout).

### Custom data

Attach arbitrary metadata to the checkout — useful for cart IDs, order IDs, anything you want correlated to webhooks later:

```ts
const checkout = await req.user.checkout(['pri_tshirt'])
checkout.customData({ orderId: order.id, source: 'mobile-app' })
```

Read it back in your webhook listener via `event.payload.data.custom_data.orderId`.

### Guest checkout

For users who don't have an account yet:

```ts
import { Checkout } from '@rudderjs/cashier-paddle'

const checkout = Checkout.guest(['pri_34567'])
checkout.returnTo('/welcome')
return view('billing', { options: checkout.options() })
```

## Price Previews

Paddle prices can be configured per-currency. `previewPrices()` returns the localized price for a list of price IDs:

```ts
import { previewPrices } from '@rudderjs/cashier-paddle'

const prices = await previewPrices(['pri_123', 'pri_456'])
```

The currency is inferred from the request IP unless you pass an address:

```ts
const prices = await previewPrices(['pri_123'], {
  address: { countryCode: 'BE', postalCode: '1234' },
})
```

Render the result:

```tsx
{prices.map(p => (
  <li key={p.priceId}>{p.product.name} — {p.totalFormatted}</li>
))}
```

`p.subtotal` and `p.tax` are available separately if you need them.

### Customer-specific previews

If the user is already a customer, prices come back in their currency:

```ts
const prices = await user.previewPrices(['pri_123', 'pri_456'])
```

### Discounts

Pass a `discountId`:

```ts
const prices = await previewPrices(['pri_123'], { discountId: 'dsc_123' })
```

## Customers

### Customer defaults

Override `paddleName()` and `paddleEmail()` on your billable model to control what gets pre-filled in the checkout widget:

```ts
export class User extends Billable(Model) {
  paddleName():  string { return this.fullName }
  paddleEmail(): string { return this.email }
}
```

### Retrieving customers

```ts
import { Cashier } from '@rudderjs/cashier-paddle'

const Customer = await Cashier.customerModel()
const customer = await Customer.where('paddleId', paddleCustomerId).first()  // → Customer record or null
// customer.billableId / customer.billableType point back to the owning model
```

Or directly from a user:

```ts
const customer = await user.customer()      // record only (or null)
const customer = await user.asCustomer()    // creates if missing
```

### Creating customers

To create a Paddle customer record without starting a subscription:

```ts
const customer = await user.createAsCustomer({
  name:  'Custom name',
  email: 'override@example.com',
})
```

Useful for "generic trials" (see [Without payment method up front](#without-payment-method-up-front)).

## Subscriptions

### Creating subscriptions

```ts
const checkout = await user.subscribe(['pri_123'], 'default')
checkout.customData({ orgId: org.id })
checkout.returnTo('/dashboard')
return view('billing', { options: checkout.options() })
```

The second argument is the subscription **type**. Use `default` if you only have one subscription per user; use named types (`swimming`, `pro_seat`) if a user can hold multiple in parallel.

After the user finishes checkout, Paddle dispatches `subscription_created`. Cashier persists the subscription row.

### Checking status

```ts
const sub = await user.subscription('default')   // SubscriptionResource | null

if (await user.subscribed())                    { /* any active sub */ }
if (await user.subscribed('default'))           { /* the default sub */ }
if (sub?.onTrial())                             { /* in trial */ }
if (sub?.recurring())                           { /* active, post-trial, not on grace period */ }
if (sub?.canceled())                            { /* canceled (may still be on grace period) */ }
if (sub?.onGracePeriod())                       { /* canceled but still active until period end */ }
if (sub?.pastDue())                             { /* failed charge — payment update needed */ }
if (sub?.paused())                              { /* paused */ }
if (sub?.onPausedGracePeriod())                 { /* paused at next interval, still active until then */ }
```

`SubscriptionResource` is a wrapper around the DB record. The state predicates (`active()`, `onTrial()`, etc.) are pure functions over the record — same logic available standalone via `subscriptionHelpers`:

```ts
import { subscriptionHelpers } from '@rudderjs/cashier-paddle'

if (subscriptionHelpers.isActive(record)) { /* ... */ }
```

#### Past-due semantics

`subscribed()` is `true` for: active, trialing, paused-on-grace, canceled-on-grace. By default, `past_due` returns `false` until the customer updates payment. To treat past-due as still-subscribed:

```ts
import { Cashier } from '@rudderjs/cashier-paddle'

Cashier.keepPastDueSubscriptionsActive()   // typically in AppServiceProvider.register()
```

> [!WARNING]
> A `past_due` subscription cannot be modified — `swap()`, `updateQuantity()`, etc. throw. Direct the customer to update their payment method first.

### Single charges on a subscription

Charge a one-time amount on top of an existing subscription:

```ts
// Bills at next interval
await sub.charge([{ priceId: 'pri_addon' }])

// Bills immediately
await sub.chargeAndInvoice([{ priceId: 'pri_addon' }])
```

### Updating payment information

Paddle stores one payment method per subscription. To let the customer update theirs, redirect them to Paddle's hosted update page:

```ts
const url = await sub.redirectToUpdatePaymentMethod()
return Response.redirect(url)
```

After the update, Paddle dispatches `subscription_updated` and the change reflects in your DB.

### Changing plans

```ts
await sub.swap('pri_premium')                    // change at next billing cycle
await sub.swapAndInvoice('pri_premium')          // change + bill now
```

#### Prorations

Paddle prorates by default. To disable:

```ts
await sub.noProrate().swap('pri_premium')
await sub.noProrate().swapAndInvoice('pri_premium')
await sub.doNotBill().swap('pri_premium')        // no charge at all
```

### Subscription quantity

```ts
await sub.incrementQuantity()       // +1
await sub.incrementQuantity(5)      // +5
await sub.decrementQuantity(2)      // -2
await sub.updateQuantity(10)        // set to 10
await sub.noProrate().updateQuantity(10)
```

For multi-product subscriptions, target a specific price:

```ts
await sub.incrementQuantity(1, 'price_chat')
```

### Subscriptions with multiple products

```ts
const checkout = await user.subscribe(
  [
    { priceId: 'price_monthly' },
    { priceId: 'price_chat', quantity: 5 },
  ],
  'default',
)
```

To add or remove prices on an existing subscription, pass the **full new set** (Paddle replaces, doesn't merge):

```ts
await sub.swap(['price_monthly', 'price_chat'])
await sub.swapAndInvoice(['price_monthly', 'price_chat'])
```

### Multiple subscriptions per user

Use distinct types:

```ts
await user.subscribe(['pri_swimming_monthly'], 'swimming')
await user.subscribe(['pri_gym_monthly'],      'gym')

const swim = await user.subscription('swimming')
await swim.swap('pri_swimming_yearly')
await swim.cancel()
```

### Pausing

```ts
await sub.pause()                                // pause at next interval (current period stays active)
await sub.pauseNow()                             // pause immediately
await sub.pauseUntil(new Date('2026-12-01'))     // pause until a date
await sub.pauseNowUntil(new Date('2026-12-01'))  // pause now until a date

if (sub.onPausedGracePeriod()) { /* paused at next interval, still active until then */ }

await sub.resume()
```

> [!WARNING]
> A paused subscription can't be swapped or have quantity changes. Resume first, then modify.

### Canceling

```ts
await sub.cancel()                  // cancel at end of period (grace period)
await sub.cancelNow()               // cancel immediately
await sub.stopCancelation()         // undo a scheduled cancellation (only works during grace period)

if (sub.onGracePeriod()) { /* canceled, still active until period ends */ }
```

> [!WARNING]
> Paddle subscriptions cannot be resumed after cancellation completes. Customers must create a new subscription. (`stopCancelation()` only works while still on grace period.)

## Subscription Trials

### With payment method up front

Configure a trial period in the Paddle dashboard on the price your customer subscribes to. The checkout flow is identical to non-trial:

```ts
const checkout = await user.subscribe(['pri_monthly'], 'default')
checkout.returnTo('/dashboard')
return view('billing', { options: checkout.options() })
```

When `subscription_created` fires, Cashier records the `trialEndsAt` timestamp and Paddle holds off charging until the trial ends.

```ts
if (await user.onTrial())                      { /* in any trial */ }
if (await user.onTrial('default'))             { /* default sub trial */ }
if (await user.hasExpiredTrial('default'))     { /* trial ran out */ }
```

> [!WARNING]
> If the customer doesn't cancel before the trial ends, they're charged automatically. Notify users about their trial-end date.

### Without payment method up front

To grant a trial without taking payment info ("generic trial"), set `trialEndsAt` on the customer record at signup:

```ts
const user = await User.create({ /* ... */ })
await user.createAsCustomer({ trialEndsAt: addDays(new Date(), 10) })
```

```ts
if (await user.onTrial())          { /* still in generic trial */ }
if (await user.onGenericTrial())   { /* in generic trial AND no real subscription yet */ }
```

When the user is ready to convert, just call `subscribe()` normally.

```ts
const trialEnd = await user.trialEndsAt('default')   // Date | null
```

### Extending or activating

```ts
await sub.extendTrial(addDays(new Date(), 5))   // push trial end
await sub.activate()                             // end trial early, start charging
```

## Handling Webhooks

`registerCashierRoutes(Route)` mounts `POST /paddle/webhook` with `[captureRawBody(), verifyPaddleWebhook()]`. Cashier handles the canonical events out of the box — you don't have to write a single handler to keep your DB in sync.

In the Paddle dashboard, [register your webhook URL](https://vendors.paddle.com/notifications-v2) and enable at minimum:

- Customer Updated
- Transaction Completed
- Transaction Updated
- Subscription Created
- Subscription Updated
- Subscription Paused
- Subscription Canceled

> [!WARNING]
> Always set `PADDLE_WEBHOOK_SECRET`. The signature middleware fails closed (HTTP 500) if the secret is missing — this is intentional. A misconfigured secret is a bug, not a "let everything through" condition.

On top of the HMAC check, `verifyPaddleWebhook` enforces a **replay window**: the signed timestamp must be within `webhookTolerance` seconds of now, otherwise the request is rejected with HTTP 403. The timestamp is part of Paddle's signed payload, so it can't be forged — this only rejects an authentic request replayed outside the window. The default is 300 seconds (5 minutes); set `webhookTolerance: 0` in `config/cashier.ts` to disable it for environments with large clock skew.

```ts
// config/cashier.ts
export default {
  apiKey:          Env.get('PADDLE_API_KEY', ''),
  clientSideToken: Env.get('PADDLE_CLIENT_SIDE_TOKEN', ''),
  webhookSecret:   Env.get('PADDLE_WEBHOOK_SECRET', ''),
  sandbox:         Env.get('PADDLE_SANDBOX', 'true') === 'true',
  webhookTolerance: 300, // seconds; 0 disables the replay window
} satisfies CashierConfig
```

### Defining event handlers

Cashier emits framework events for each canonical webhook. Listen via `eventsProvider`:

```ts
// bootstrap/providers.ts
import { eventsProvider } from '@rudderjs/core'
import { OnTransactionCompleted } from '../app/Listeners/OnTransactionCompleted.js'

export default [
  // ...
  eventsProvider({
    'cashier.transaction.completed': [OnTransactionCompleted],
  }),
]
```

```ts
// app/Listeners/OnTransactionCompleted.ts
import type { Listener } from '@rudderjs/core'

export class OnTransactionCompleted {
  async handle({ payload, transaction, billable }: Listener.Args) {
    const orderId = payload.data.custom_data?.orderId
    if (orderId) await markOrderComplete(orderId)
  }
}
```

The full event list:

| Event | Payload includes |
|---|---|
| `cashier.customer.updated` | `payload`, `customer` |
| `cashier.transaction.completed` | `payload`, `transaction`, `billable` |
| `cashier.transaction.updated` | `payload`, `transaction`, `billable` |
| `cashier.subscription.created` | `payload`, `subscription`, `billable` |
| `cashier.subscription.updated` | `payload`, `subscription`, `billable` |
| `cashier.subscription.paused` | `payload`, `subscription`, `billable` |
| `cashier.subscription.canceled` | `payload`, `subscription`, `billable` |

For raw access to any event Paddle sends (including ones Cashier doesn't model), listen to `cashier.webhook.received`:

```ts
{ 'cashier.webhook.received': [OnAnyWebhook] }
```

### Local development

To receive Paddle webhooks against `localhost`, expose your dev server with a tunnel:

```bash
ngrok http 3000
# → https://abc123.ngrok.io → localhost:3000
```

Set the public URL as the destination in your Paddle notification settings. Or use Cashier's built-in webhook simulator for offline testing:

```bash
pnpm rudder cashier:webhook simulate transaction.completed
pnpm rudder cashier:webhook simulate subscription.created
```

`simulate` replays a fixture against your local handler — useful for unit tests and CI.

### Idempotency

Cashier dedupes webhooks at write time. The `paddleWebhookLogs.eventId` column has a unique index — duplicate retries return HTTP 200 + `{ duplicate: true }` so Paddle stops retrying. Your event listeners will fire **exactly once** per Paddle event.

### Inspecting recorded webhooks

```bash
pnpm rudder cashier:webhook inspect <eventId>
```

Prints the full stored payload, processed-at timestamp, and error details if any.

## Single Charges

### Charging for products

Use `checkout()` with the price ID(s):

```ts
const checkout = await user.checkout([
  { priceId: 'pri_tshirt' },
  { priceId: 'pri_socks', quantity: 5 },
])
```

For metadata:

```ts
checkout.customData({ couponCode: 'WELCOME10' })
```

### Refunding transactions

Refund a transaction (full or partial) via the `TransactionResource`:

```ts
const tx = (await user.transactions())[0]

// Fully refund the whole transaction
await tx.refund('Accidental charge')

// Per-line refund (full on one, partial on another)
await tx.refund('Accidental charge', [
  { priceId: 'pri_123' },                  // full refund
  { priceId: 'pri_456', amount: '200' },   // refund $2.00 (in minor units)
])
```

> [!WARNING]
> Paddle reviews refund requests before processing. Refunds are not instant.

### Crediting transactions

For manually-collected (non-subscription) transactions, you can issue a credit instead of a refund — adds funds to the customer's Paddle balance for future purchases:

```ts
await tx.credit('Compensation', [{ priceId: 'pri_123' }])
```

> [!WARNING]
> Credits only apply to manually-collected transactions. Paddle handles credits for subscription transactions automatically.

## Transactions

```ts
const transactions = await user.transactions()   // TransactionResource[]
```

Each `TransactionResource` exposes:

```ts
tx.id              // Paddle transaction ID
tx.status          // 'completed' | 'billed' | etc.
tx.total()         // formatted total
tx.tax()           // formatted tax
tx.subtotal()      // formatted subtotal
tx.billedAt        // Date
tx.invoicePdfUrl() // → presigned URL from Paddle
```

```tsx
<table>
  {transactions.map(tx => (
    <tr key={tx.id}>
      <td>{tx.billedAt.toLocaleDateString()}</td>
      <td>{tx.total()}</td>
      <td>{tx.tax()}</td>
      <td><a href={tx.invoicePdfUrl()} target="_blank">Download</a></td>
    </tr>
  ))}
</table>
```

### Past and upcoming payments

```ts
const last = await sub.lastPayment()    // TransactionResource | null (null until first webhook)
const next = await sub.nextPayment()    // { date: Date; amount: string; currency: string } | null (null after cancelation)

console.log(`Next: ${next.amount} ${next.currency} due ${next.date.toLocaleDateString()}`)
```

## CLI

```bash
pnpm rudder cashier:install                          # publish schema fragment + React views
pnpm rudder cashier:webhook inspect <eventId>        # look up a recorded webhook
pnpm rudder cashier:webhook simulate <eventType>     # replay a fixture against local handler
pnpm rudder cashier:sync [--since 2026-01-01]        # backfill from Paddle
```

`cashier:sync` walks Paddle's API and reconciles customers, subscriptions, and transactions into your database. Use it after the initial install (to populate from existing Paddle data) or to recover from missed webhooks.

## Testing

For unit tests, mock the Paddle SDK directly:

```ts
import { resetPaddleClient } from '@rudderjs/cashier-paddle'

beforeEach(() => {
  resetPaddleClient()
  globalThis.__paddle__ = {
    subscriptions: {
      cancel:  async (id) => ({ id, status: 'canceled' }),
      pause:   async (id) => ({ id, status: 'paused'   }),
      // ... etc
    },
  }
})
```

`resetPaddleClient()` clears the lazy-loaded SDK singleton so the next call picks up the test double.

For webhook tests, replay a fixture:

```bash
pnpm rudder cashier:webhook simulate subscription.created --fixture=tests/fixtures/sub-created.json
```

## Pitfalls

- **`PADDLE_WEBHOOK_SECRET` not set** — webhook returns 500 (fail-closed by design).
- **CSRF blocks the webhook** — exclude `paddle/*` from CSRF if you use CsrfMiddleware on the `web` group.
- **`@paddle/paddle-node-sdk` not installed** — server-side calls (`subscription.swap()`, `previewPrices()`, etc.) throw with an actionable install message. Checkout-only apps don't need it.
- **`prisma db push` after install** — `cashier:install` writes the schema fragment but doesn't run Prisma. Run `pnpm exec prisma generate && pnpm exec prisma db push` after.
- **Decimal arithmetic on amounts** — Paddle sends totals as **strings in minor units**. Never `Number()` them — use string math or BigInt. `formatAmount()` is display-only.
- **`Cashier.useBillableModel` not called** — the webhook can still write DB rows but can't materialize the user object for event listeners. Call it from `routes/web.ts` or `AppServiceProvider.boot()`.
- **`static table` set to the SQL name** — queries throw `Prisma has no delegate for table "paddle_subscriptions"`. Use the camelCase Prisma delegate name (`paddleSubscription`).

## Related

- [Authentication](/guide/authentication) — `Billable` mixes onto your auth model
- [Database](/guide/database) — ORM the cashier tables build on
- [Events](/guide/events) — the webhook → listener integration
- [Paddle API reference](https://developer.paddle.com/api-reference/overview)
