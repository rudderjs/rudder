import type { Table } from './schema/Table.js'
import { createRegistry } from './BaseRegistry.js'

/**
 * @internal — runtime registry of Table instances.
 * Populated by resolveSchema() on first SSR request.
 * Looked up by the table data API endpoint for lazy/poll/paginated tables.
 */
export const TableRegistry = createRegistry<Table>()
