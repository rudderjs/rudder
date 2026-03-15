import { mysqlTable, varchar, text, index } from 'drizzle-orm/mysql-core'

export const notification = mysqlTable('notification', {
  id:              varchar('id', { length: 36 }).primaryKey(),
  notifiable_id:   varchar('notifiable_id', { length: 255 }).notNull(),
  notifiable_type: varchar('notifiable_type', { length: 255 }).notNull(),
  type:            varchar('type', { length: 255 }).notNull(),
  data:            text('data').notNull(),
  read_at:         varchar('read_at', { length: 255 }),
  created_at:      varchar('created_at', { length: 255 }).notNull(),
  updated_at:      varchar('updated_at', { length: 255 }).notNull(),
}, (table) => [
  index('notification_notifiable_idx').on(table.notifiable_type, table.notifiable_id),
])
