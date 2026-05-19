---
'@rudderjs/cashier-paddle': minor
---

`Billable.createAsCustomer` no longer silently swallows Paddle API errors.
Previously the catch was unconditional and intended to handle "SDK not
configured" (tests, mock mode) — but it also swallowed real failures like
409 `customer_email_in_use`, causing a local `PaddleCustomer` row to be
persisted with `paddleId = null`. The user then completed Paddle Checkout
successfully, Paddle fired `subscription.created` against the existing
customer id, and the consumer's webhook handler couldn't find the local
row by `paddleId` — so the customer paid and never received their
subscription. Surfaced 2026-05-19 by pilotiq.io's first prod checkout.

What changes:

- The "SDK unavailable" path stays working. `await paddle()` is now in its
  own try/catch — a throw there (no `PADDLE_API_KEY`, `@paddle/paddle-node-sdk`
  not installed) still falls through with `paddleId = null`, same as before.
- Real Paddle API errors (`fn.call(client.customers, ...)` rejecting) are
  no longer swallowed. They throw a new `BillablePaddleError` that wraps
  the original error on `.cause` and exposes Paddle's `.code` (read from
  both `err.code` and `err.error.code`). The local row is NOT persisted
  in the broken state — callers can catch at the request boundary and
  surface a friendly message.

New exports:

- `BillablePaddleError` — typed error for `createAsCustomer` API failures.
- `setPaddleClientForTesting(client)` — `@internal` test override for
  injecting a stand-in Paddle client.

Behaviorally breaking only for consumers that relied on the silent
`paddleId = null` fallback as their "customer creation succeeded" signal.
Most consumers will see this as a strictly-better experience — their
`POST /subscribe` (or equivalent) endpoint now surfaces the underlying
error instead of letting the customer pay and not get linked.
