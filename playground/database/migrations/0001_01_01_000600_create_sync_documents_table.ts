import { Migration, Schema } from '@rudderjs/orm/native'

// @rudderjs/sync — syncDatabase() persistence (see config/sync.ts). Same
// shape as the package's published sync-schema migration: the `syncDocument`
// name matches syncPrisma()'s delegate default so playground-prisma shares
// the table layout. Append-only Yjs update log; `createdAt` keeps a
// database-side default because the driver never stamps timestamps app-side.
export default class extends Migration {
  async up() {
    await Schema.create('syncDocument', (t) => {
      t.id()
      t.string('docName').index()
      t.binary('update')
      t.dateTime('createdAt').useCurrent()
    })
  }

  async down() {
    await Schema.dropIfExists('syncDocument')
  }
}
