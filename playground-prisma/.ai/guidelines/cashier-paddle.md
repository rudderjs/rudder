# @rudderjs/cashier-paddle

## Overview

Paddle billing integration for RudderJS. Provides subscription management, customer records, webhook intake, checkout session creation, and pricing previews. The `Cashier` static facade is the configuration entry point; the `Billable` mixin attaches subscription / customer methods to your `User` model. Mirrors Laravel Cashier's surface.

## Key Patterns

### Make a model billable

```ts
import { Model } from '@rudderjs/orm'
import { Billable } from '@rudderjs/cashier-paddle'

export class User extends Billable(Model) {
  static table = 'users'
}
```

Register the billable model so webhook handlers can rehydrate it (call once at boot — `bootstrap/app.ts` or your `AppServiceProvider`):

```ts
import { Cashier } from '@rudderjs/cashier-paddle'
import { User } from '../app/Models/User.js'

Cashier.useBillableModel(User)
```

Then in app code:

```ts
const user = await User.find(1)
await user.subscribe('default', { priceId: 'pri_01...' })
const sub = await user.subscription('default')
if (sub?.active()) { /* … */ }
```

### Configure (`config/cashier.ts`)

```ts
import type { CashierConfig } from '@rudderjs/cashier-paddle'

export default {
  apiKey:         Env.get('PADDLE_API_KEY', ''),
  webhookSecret:  Env.get('PADDLE_WEBHOOK_SECRET', ''),
  environment:    Env.get('PADDLE_ENV', 'sandbox'),     // 'sandbox' | 'production'
} satisfies CashierConfig
```

`CashierProvider` is auto-discovered. It calls `Cashier.configure(config)` during `boot()` and registers the webhook route.

### Mount the webhook

```ts
// routes/api.ts (or wherever you want it)
import { Route } from '@rudderjs/router'
import { registerCashierRoutes } from '@rudderjs/cashier-paddle'

registerCashierRoutes(Route)
// Registers POST /paddle/webhook
```

The handler verifies HMAC over the **raw request body** — `captureRawBody()` middleware must run before. Provider boot handles this automatically when routes are registered via `registerCashierRoutes`.

### Resources (fluent wrappers)

Models return plain records for cross-driver portability; wrap them when you want fluent operations:

```ts
import { SubscriptionResource, CustomerResource } from '@rudderjs/cashier-paddle'

const sub = await user.subscription('default')
const wrapped = new SubscriptionResource(sub!)
await wrapped.swap({ priceId: 'pri_new' })
await wrapped.cancel()             // graceful, period-end cancellation
await wrapped.cancelNow()          // immediate
```

### Checkout + price previews

```ts
import { previewPrices, handlePaddleWebhook } from '@rudderjs/cashier-paddle'

const preview = await previewPrices(['pri_01...'], { customerId, currencyCode: 'USD' })
```

## Common Pitfalls

- **`PADDLE_WEBHOOK_SECRET` not set**: webhook returns HTTP 500 (fail-closed) — without a secret the HMAC check can't run. Misconfiguration shouldn't silently accept events.
- **`Cashier.useBillableModel(User)` not called**: webhook handlers can still update the DB tables, but they can't materialize the `User` instance for `.subscription()` / `.subscribed()` from the webhook context. Call it from `bootstrap/app.ts` or an app service provider.
- **CSRF blocks the webhook**: if you register the webhook on a route group with CSRF middleware (`web` by default), add `/paddle/webhook` to the exclude list. Or register on `api` instead.
- **Raw body required for signature**: middleware that JSON-parses the body BEFORE `captureRawBody` runs will break HMAC verification — bytes don't round-trip through `JSON.stringify`.
- **Missing `prisma generate` after `cashier:install`**: the install command publishes the Prisma schema additions but does NOT regenerate the client. Run `pnpm exec prisma db push && pnpm exec prisma generate` after.
- **Static table is the Prisma camelCase delegate**, not the `@@map` SQL name: use `paddleSubscription`, not `paddle_subscriptions`.
- **Amounts are strings, not numbers**: Paddle returns minor-unit amounts as decimal strings (e.g. `"1999"` = $19.99). Use string math or `BigInt`; never `Number()` arithmetic — floating-point destroys cents at scale.
- **`@paddle/paddle-node-sdk` is an optional peer**: install it only if you call API methods beyond webhook intake. Checkout-only apps skip it.

## Key Imports

```ts
import {
  Cashier,                       // facade — Cashier.configure(...)
  Billable,                      // mixin — extends Model classes
  CashierProvider,               // service provider (auto-discovered; import only to opt out)
  SubscriptionResource,
  CustomerResource,
  registerCashierRoutes,         // mount POST /paddle/webhook
  previewPrices,                 // pricing preview API
  handlePaddleWebhook,           // raw handler (for custom mounting)
} from '@rudderjs/cashier-paddle'

import type {
  CashierConfig,
  SubscriptionStatus,
  PaddleEnvironment,
} from '@rudderjs/cashier-paddle'
```
