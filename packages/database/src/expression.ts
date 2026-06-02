// Raw SQL expression wrapper — moved to @rudderjs/contracts so the query
// builder's raw methods stay client-safe (@rudderjs/database is node-only).
// Re-exported here to keep `DB.raw()` and `import { raw } from
// '@rudderjs/database'` working.
export { Expression, raw } from '@rudderjs/contracts'
