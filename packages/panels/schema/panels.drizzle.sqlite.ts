import { sqliteTable, text, blob, integer, index } from 'drizzle-orm/sqlite-core'

export const panelVersion = sqliteTable('PanelVersion', {
  id:        text('id').primaryKey(),
  docName:   text('docName').notNull(),
  snapshot:  blob('snapshot', { mode: 'buffer' }).notNull(),
  label:     text('label'),
  userId:    text('userId'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('panel_version_doc_idx').on(table.docName, table.createdAt),
])

export const panelGlobal = sqliteTable('PanelGlobal', {
  slug:      text('slug').primaryKey(),
  data:      text('data').notNull().default('{}'),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
})
