import type { Table } from './schema/Table.js'

/**
 * @internal — runtime registry of Table instances.
 * Populated by resolveSchema() on first SSR request.
 * Looked up by the table data API endpoint for lazy/poll/paginated tables.
 */
export class TableRegistry {
  private static tables = new Map<string, Table>()

  static register(panelName: string, tableId: string, table: Table): void {
    TableRegistry.tables.set(`${panelName}:${tableId}`, table)
  }

  static get(panelName: string, tableId: string): Table | undefined {
    return TableRegistry.tables.get(`${panelName}:${tableId}`)
  }

  /** @internal — for testing */
  static reset(): void {
    TableRegistry.tables.clear()
  }
}
