import { mysqlTable, varchar, boolean, datetime, text } from 'drizzle-orm/mysql-core'

export const user = mysqlTable('user', {
  id:            varchar('id', { length: 36 }).primaryKey(),
  name:          varchar('name', { length: 255 }).notNull(),
  email:         varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image:         text('image'),
  role:          varchar('role', { length: 50 }).notNull().default('user'),
  createdAt:     datetime('createdAt').notNull().$defaultFn(() => new Date()),
  updatedAt:     datetime('updatedAt').notNull().$defaultFn(() => new Date()),
})

export const session = mysqlTable('session', {
  id:        varchar('id', { length: 36 }).primaryKey(),
  expiresAt: datetime('expiresAt').notNull(),
  token:     varchar('token', { length: 255 }).notNull().unique(),
  createdAt: datetime('createdAt').notNull(),
  updatedAt: datetime('updatedAt').notNull(),
  ipAddress: varchar('ipAddress', { length: 255 }),
  userAgent: text('userAgent'),
  userId:    varchar('userId', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
})

export const account = mysqlTable('account', {
  id:                    varchar('id', { length: 36 }).primaryKey(),
  accountId:             varchar('accountId', { length: 255 }).notNull(),
  providerId:            varchar('providerId', { length: 255 }).notNull(),
  userId:                varchar('userId', { length: 36 }).notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken:           text('accessToken'),
  refreshToken:          text('refreshToken'),
  idToken:               text('idToken'),
  accessTokenExpiresAt:  datetime('accessTokenExpiresAt'),
  refreshTokenExpiresAt: datetime('refreshTokenExpiresAt'),
  scope:                 text('scope'),
  password:              text('password'),
  createdAt:             datetime('createdAt').notNull(),
  updatedAt:             datetime('updatedAt').notNull(),
})

export const verification = mysqlTable('verification', {
  id:         varchar('id', { length: 36 }).primaryKey(),
  identifier: varchar('identifier', { length: 255 }).notNull(),
  value:      text('value').notNull(),
  expiresAt:  datetime('expiresAt').notNull(),
  createdAt:  datetime('createdAt'),
  updatedAt:  datetime('updatedAt'),
})
