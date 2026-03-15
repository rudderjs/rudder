import { pgTable, text, bytea, timestamp, index } from 'drizzle-orm/pg-core'

export const panelVersion = pgTable('PanelVersion', {
  id:        text('id').primaryKey(),
  docName:   text('docName').notNull(),
  snapshot:  bytea('snapshot').notNull(),
  label:     text('label'),
  userId:    text('userId'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, (table) => [
  index('panel_version_doc_idx').on(table.docName, table.createdAt),
])

export const panelGlobal = pgTable('PanelGlobal', {
  slug:      text('slug').primaryKey(),
  data:      text('data').notNull().default('{}'),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})
