// ─── @rudderjs/queue/native ────────────────────────────────
//
// Persistent, self-hosted database-backed queue driver — the zero-infrastructure
// default tier, modeled on Laravel's `database` driver and backed by the native
// ORM engine (`@rudderjs/orm/native`). Selected via `driver: 'database'` in
// config/queue.ts. BullMQ (`@rudderjs/queue-bullmq`) and Inngest
// (`@rudderjs/queue-inngest`) remain the high-throughput / cloud tiers.
//
// Lives inside @rudderjs/queue (mirroring orm/native) but reaches the ORM via
// `resolveOptionalPeer` at runtime, so importing this subpath does not pull the
// ORM into the queue package's dependency graph.

export { DatabaseQueueAdapter, database } from './adapter.js'
export type { DatabaseQueueConfig } from './adapter.js'
export {
  defineJobsTable,
  defineFailedJobsTable,
  jobsTableStub,
  failedJobsTableStub,
} from './migrations.js'
export type { QueueBlueprint } from './migrations.js'
