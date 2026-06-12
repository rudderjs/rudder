---
"@rudderjs/cashier-paddle": minor
---

Harden the Paddle webhook receiver.

- **Replay protection.** `verifyPaddleWebhook` now checks the signed `ts` against the current time and rejects a request whose timestamp is outside the tolerance window (HTTP 403). The timestamp is part of Paddle's signed payload, so a forged request can never reach this check; it rejects an authentic request that is replayed outside the window. Configurable via the new `webhookTolerance` config key (seconds, default 300 / 5 minutes; set `0` to disable for environments with large clock skew).
- **Subscription items are now persisted.** Every `subscription.*` webhook carries the full line-item set, but the handler parsed it and never wrote it to `paddle_subscription_items`, leaving `SubscriptionResource.items()` / `.swap()` reading an empty set. The webhook handler and `cashier:sync` now reconcile the items table (upsert by `priceId`, prune removed lines) so the local rows reflect the canonical subscription.
