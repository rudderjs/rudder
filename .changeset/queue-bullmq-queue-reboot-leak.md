---
"@rudderjs/queue-bullmq": patch
---

Reuse BullMQ `Queue` connections across dev HMR re-boots. `QueueProvider` rebuilds the adapter on every `app/` edit, so each re-boot's first dispatch lazily opened a fresh `Queue` (a Redis connection) per name and orphaned the previous one — a connection leaked per edit. The per-name queue map is now cached on `globalThis` keyed by the connection + prefix signature: an unchanged signature reuses the live queues, a changed one closes the superseded ones. `Queue` handles are producer-only (no job code — that lives in the per-boot job registry), so reuse is safe. Workers are unaffected (created only by the `queue:work` CLI, a separate non-HMR process). No-op in production.
