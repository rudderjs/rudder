// @rudderjs/database — the SQL data-layer foundation.
//
// PR1 establishes the package boundary + the public `DB` facade contract. The
// query-builder breadth, connection manager, and native-engine internals land in
// later PRs (see docs/plans/2026-06-01-database-package-extraction-PR1.md).

export { DB } from './db.js'
export type { DBConnection } from './db.js'
export { Expression, raw } from './expression.js'
export {
  registerAdapterResolver,
  resolveAdapter,
  registerTransactionRunner,
  resolveTransactionRunner,
  registerConnectionResolver,
  resolveConnectionResolver,
  registerNamedTransactionRunner,
  resolveNamedTransactionRunner,
  __resetAdapterResolver,
} from './registry-bridge.js'
export type { TransactionRunner, ConnectionResolver, NamedTransactionRunner } from './registry-bridge.js'
export type { Row, Executor, Transaction, Connection } from './execution.js'
export type { QueryEvent, QueryListener } from '@rudderjs/contracts'
