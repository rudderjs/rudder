# @rudderjs/cashier-paddle

Paddle billing for RudderJS — Billable mixin, subscription state machine, signed webhook receiver, checkout session, refunds, pricing previews.

## Key Files

- `src/index.ts` — Re-exports + `CashierPaddleProvider`
- `src/Cashier.ts` — Static config singleton (credentials, sandbox flag, model overrides, past-due flag)
- `src/contracts.ts` — Driver-agnostic record interfaces (future-extractable to `@rudderjs/cashier`)
- `src/state.ts` — Pure umbrella predicates that read `Cashier.pastDueIsActive()` (future-extractable)
- `src/format.ts` — `formatAmount()` via `Intl.NumberFormat` (no money lib)
- `src/billable.ts` — `Billable()` higher-order class (mirror of passport's `HasApiTokens`)
- `src/Checkout.ts` — Checkout value object + `Checkout.guest(prices)`
- `src/paddle-client.ts` — Lazy `@paddle/paddle-node-sdk` loader (optional peer dep)
- `src/preview.ts` — `previewPrices()` for localized price previews
- `src/routes.ts` — `registerCashierRoutes()`
- `src/models/` — Customer, Subscription, SubscriptionItem, Transaction, WebhookLog
- `src/models/helpers.ts` — Pure-function record helpers (state predicates, totals)
- `src/resources/` — `SubscriptionResource`, `TransactionResource` wrapper classes
- `src/webhooks/{events,transformers,handler,idempotency}.ts` — webhook layer
- `src/middleware/{raw-body,verify-paddle-webhook}.ts` — webhook middleware
- `src/commands/{install,webhook,sync}.ts` — CLI commands
- `schema/cashier-paddle.prisma` — 5 tables (customers, subscriptions, items, transactions, webhook log), Prisma engine
- `schema/native/*.ts` — the same 5 tables as a native-engine migration (SQL `@@map` names, string ulid PKs); published to `database/migrations` on native apps
- `views/react/{CheckoutButton,InlineCheckout,PaddleScript}.tsx` — drop-in components

## Architecture Rules

- **Wrapper class for fluent chaining** — ORM returns plain records, NOT instances. `Billable.subscription()` returns a `SubscriptionResource` wrapper around the record so `.cancel()` / `.swap()` etc. work. Wrapper writes go through static `Subscription.update(id, ...)` + the Paddle SDK; reads delegate to `subscriptionHelpers` from `models/helpers.ts`.
- **Webhook is standalone-mounted** — `registerCashierRoutes(Route)` registers `POST /paddle/webhook` with `[captureRawBody(), verifyPaddleWebhook()]`. The route ends up in whichever group the consumer's `routes/<group>.ts` file loaded it in — if you register inside `routes/web.ts`, **exempt the path from CSRF**: `CsrfMiddleware({ exclude: ['/paddle/webhook'] })`. `verifyPaddleWebhook` fails closed with HTTP 500 when no secret is configured (mis-configuration is a bug, not a "let everything through" condition).
- **Raw-body capture before signature verify** — Paddle's HMAC is computed over the exact bytes; any reformatting breaks it. `captureRawBody()` reads the underlying Web Request and stashes both raw bytes and parsed JSON on `req.raw`.
- **Replay window after signature verify** — `verifyPaddleWebhook` checks the signed `ts` against now and rejects (HTTP 403 `timestamp_out_of_tolerance`) when it's outside `Cashier.webhookTolerance()` seconds (default 300; `0` disables). The `ts` is inside the signed payload, so this only fires on an authentic request replayed outside the window. The check runs AFTER the HMAC compare so a bad signature still returns 401 first.
- **Subscription items are persisted on every `subscription.*` event** — `upsertSubscription()` (handler) and `cashier:sync` call `syncSubscriptionItems(subscriptionId, frag.items)` from `webhooks/items.ts`. It reconciles `paddle_subscription_items` (upsert by `priceId`, prune removed lines) rather than delete-all-then-insert, so a transient mid-reconcile failure leaves the prior rows in place and unchanged items keep stable ids. `SubscriptionResource.items()`/`.swap()` read this table.
- **Idempotency at write time** — `paddle_webhook_logs.eventId` has a unique index; `markProcessed()` is the dedup gate. Duplicate retries return 200 + `{ duplicate: true }` so Paddle stops retrying.
- **Paddle SDK is optional** — `@paddle/paddle-node-sdk` is a peer dep with `optional: true`. `paddle()` lazy-imports + throws an actionable error if missing. Apps doing only checkout (Paddle.js) without server-side calls don't need to install it.
- **Webhook handler is the source of truth** — wrapper mutations (e.g. `subscription.cancel()`) issue the SDK call then re-read from DB rather than trusting the SDK response. The webhook will arrive seconds later with the canonical row. The `subscription.paused`/`subscription.canceled` handlers, which do a second write to stamp `pausedAt`/`endsAt`, **re-read the row after that write** so the dispatched event carries the persisted state, not an in-memory patch.
- **Orphaned-transaction backfill** — a `transaction.*` webhook can land before its billable is linked to a Paddle customer (webhook racing the local Customer row write, or an imported dashboard customer); the transaction is then written with an empty `billableId` and is invisible to `transactions()`. `createAsCustomer()` calls `linkOrphanedTransactions(paddleId, …)` after creating the Customer row to claim those rows (match on `paddleCustomerId` + empty `billableId`). Best-effort (wrapped in try/catch — never blocks customer creation). Subscriptions can't be backfilled this way (no `paddleCustomerId` column); the common path resolves them at create time because `createAsCustomer` runs before checkout, and `cashier:sync` covers imports.
- **Single configurable Billable model in v1** — `Cashier.useBillableModel(User)` from your routes/provider. Schema has `billable_id` + `billable_type` columns reserved for future polymorphic v2.
- **`static table` is the SQL table name** (`@@map` — `paddle_subscriptions`), so the 5 models run unchanged on the **native engine** (literal SQL name) AND on **Prisma** (orm-prisma's runtime-datamodel fallback maps the SQL name → `paddleSubscription` delegate; needs `@rudderjs/orm-prisma` ≥ the SQL-name-fallback release). The pre-`@rudderjs/cashier-paddle@5` delegate-name-in-`table` contract is gone. **`static keyType = 'ulid'`** on all 5 models stamps an app-generated id on insert (the native engine has no `@default(cuid())`); on Prisma, new rows get a ulid instead of a cuid — both opaque strings, so existing cuid rows coexist with no migration.
- **Native engine support** — `vendor:publish --tag=cashier-schema` publishes `schema/cashier-paddle.prisma` on Prisma apps and `schema/native/*.ts` (a migration mirroring the `@@map` names, string ulid PKs) to `database/migrations` on native-engine apps. Keep the two in sync when columns change.
- **Past-due semantics match Cashier** — `subscribed()` is true for active, trialing, paused-on-grace, canceled-on-grace; flip past-due into "active too" with `Cashier.keepPastDueSubscriptionsActive()`.

## Doctor checks

Ships `src/doctor.ts`: `cashier-paddle:api-key`, `cashier-paddle:webhook-secret` — both warn when unset; the webhook-secret check was the post-mortem trigger for the doctor command itself (see [`docs/plans/2026-05-19-rudder-doctor-command.md`](../../docs/plans/2026-05-19-rudder-doctor-command.md)).

## Commands

```bash
pnpm build      # tsc
pnpm typecheck  # tsc --noEmit
```

## CLI Commands (registered in provider boot)

- `rudder cashier:install` — Publish the schema fragment + React views into `app/`
- `rudder cashier:webhook inspect <event_id>` — Look up a recorded webhook log entry
- `rudder cashier:webhook simulate <event_type>` — Replay a fixture against the local handler
- `rudder cashier:sync [--since <iso-date>]` — Backfill customers/subscriptions/transactions from Paddle

## Usage

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

```ts
// app/Models/User.ts
import { Model } from '@rudderjs/orm'
import { Billable } from '@rudderjs/cashier-paddle'

export class User extends Billable(Model) {
  // ...
}
```

```ts
// routes/web.ts
import { registerCashierRoutes, Cashier } from '@rudderjs/cashier-paddle'
import { User } from '../app/Models/User.js'

registerCashierRoutes(Route)
Cashier.useBillableModel(User)
```

```ts
// In a controller
const checkout = await user.checkout(['pri_abc']).then(c => c.returnTo('/dashboard'))
res.json({ options: checkout.options() })       // → Paddle.Checkout.open(...)

if (await user.subscribed()) { /* ... */ }
const sub = await user.subscription()
await sub?.cancel()
```

## Pitfalls

- **`PADDLE_WEBHOOK_SECRET` not set**: webhook returns 500 (fail-closed). This is intentional — without a secret, signature verification can't run.
- **CSRF blocks the webhook**: routes registered in `routes/web.ts` inherit web-group middleware. Add `CsrfMiddleware({ exclude: ['/paddle/webhook'] })` in `bootstrap/app.ts`.
- **`@paddle/paddle-node-sdk` not installed**: server-side methods (`subscription.swap()`, `previewPrices()`, etc.) throw with an actionable install instruction. Checkout-only apps don't need it.
- **`prisma db push` after install**: `cashier:install` publishes the schema fragment but doesn't run Prisma. Run `pnpm exec prisma generate && pnpm exec prisma db push` after.
- **Decimal arithmetic on `total`/`tax`**: Paddle sends amounts as STRINGS in minor units. Never `Number()` — string math or BigInt only. `formatAmount()` is display-only.
- **`Cashier.useBillableModel` not called**: webhook handlers can still update DB tables but won't be able to materialize the User object. Call it from `routes/web.ts` or your `AppServiceProvider.boot()`.
- **Old `@rudderjs/orm-prisma` (no SQL-name fallback)**: a Prisma app on cashier-paddle ≥5 with an orm-prisma older than the SQL-name-fallback release queries 500 with `[RudderJS ORM] Prisma has no delegate for table "paddle_subscriptions"`. Upgrade `@rudderjs/orm-prisma` — it resolves the `@@map` SQL name to the delegate via the client's runtime datamodel.
