import { Migration, Schema } from '@rudderjs/orm/native'

// Tables for framework packages whose models reference Prisma-delegate-style
// table names (`static table = 'userMemory'`, etc.). On the native engine
// `static table` is the literal SQL table name, so these tables are created
// with those exact names — the packages run unchanged on either adapter.
//
// `t.id()` (integer autoincrement) stands in for Prisma's `@default(cuid())`:
// the packages insert without an id and rely on the database to assign one.
export default class extends Migration {
  async up() {
    // @rudderjs/ai — memory-orm storage
    await Schema.create('userMemory', (t) => {
      t.id()
      t.string('userId').index()
      t.text('fact')
      t.string('tags').nullable()
      t.float('score').nullable()
      t.binary('embedding').nullable()
      t.dateTime('createdAt').useCurrent()
      t.dateTime('updatedAt').useCurrent()
    })

    // @rudderjs/ai — budget-orm storage
    await Schema.create('budgetUsage', (t) => {
      t.id()
      t.string('userId')
      t.string('period')
      t.string('periodKey')
      t.float('spent').default(0)
      t.dateTime('createdAt').useCurrent()
      t.dateTime('updatedAt').useCurrent()
      t.unique(['userId', 'period', 'periodKey'])
    })

    // (syncDocument lives in its own migration — 0001_01_01_000600 — added
    // when @rudderjs/sync gained the syncDatabase() native-engine driver.)

    // @rudderjs/notification — database channel. Column names are snake_case
    // because DatabaseChannel writes them literally (notifiable_id, read_at, …).
    await Schema.create('notification', (t) => {
      t.id()
      t.string('notifiable_id')
      t.string('notifiable_type')
      t.string('type')
      t.text('data')
      t.string('read_at').nullable()
      t.string('created_at')
      t.string('updated_at')
      t.index(['notifiable_type', 'notifiable_id'])
    })
  }

  async down() {
    await Schema.dropIfExists('notification')
    await Schema.dropIfExists('budgetUsage')
    await Schema.dropIfExists('userMemory')
  }
}
