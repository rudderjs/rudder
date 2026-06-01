// ─── DB execution contracts (re-export) ────────────────────
//
// The canonical execution types — `Row`, `Executor`, `Transaction`,
// `Connection` — are owned by `@rudderjs/contracts` (the zero-dependency
// foundation, beside `OrmAdapter`). `@rudderjs/database` is their conceptual
// home — the DB *facade* — so we re-export them here as the public surface.
//
// Keeping the definitions in contracts avoids a build cycle: `@rudderjs/database`
// depends on `@rudderjs/contracts` (for `OrmAdapter`), so contracts cannot depend
// back on database. Every adapter already imports from contracts, so there's a
// single import point and no flag-day when the data layer is later extracted.

export type { Row, Executor, Transaction, Connection } from '@rudderjs/contracts'
