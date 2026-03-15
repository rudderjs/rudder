import { mysqlTable, varchar, text, mediumblob, datetime, index } from 'drizzle-orm/mysql-core'

export const panelVersion = mysqlTable('PanelVersion', {
  id:        varchar('id', { length: 36 }).primaryKey(),
  docName:   varchar('docName', { length: 255 }).notNull(),
  snapshot:  mediumblob('snapshot').notNull(),
  label:     varchar('label', { length: 255 }),
  userId:    varchar('userId', { length: 36 }),
  createdAt: datetime('createdAt').notNull().$defaultFn(() => new Date()),
}, (table) => [
  index('panel_version_doc_idx').on(table.docName, table.createdAt),
])

export const panelGlobal = mysqlTable('PanelGlobal', {
  slug:      varchar('slug', { length: 255 }).primaryKey(),
  data:      text('data').notNull().default('{}'),
  updatedAt: datetime('updatedAt').notNull().$defaultFn(() => new Date()),
})
