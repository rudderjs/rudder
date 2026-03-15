import { pgTable, text, index } from 'drizzle-orm/pg-core'

export const notification = pgTable('notification', {
  id:              text('id').primaryKey(),
  notifiable_id:   text('notifiable_id').notNull(),
  notifiable_type: text('notifiable_type').notNull(),
  type:            text('type').notNull(),
  data:            text('data').notNull(),
  read_at:         text('read_at'),
  created_at:      text('created_at').notNull(),
  updated_at:      text('updated_at').notNull(),
}, (table) => [
  index('notification_notifiable_idx').on(table.notifiable_type, table.notifiable_id),
])
