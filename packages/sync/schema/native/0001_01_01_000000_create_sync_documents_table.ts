import { Migration, Schema } from '@rudderjs/orm/native'

// @rudderjs/sync — syncDatabase() persistence table. Published by
// `pnpm rudder vendor:publish --tag=sync-schema` on native-engine apps.
//
// The table name `syncDocument` is load-bearing: it matches syncPrisma()'s
// delegate default, so an app's Prisma and native twins share one table.
// Append-only update log — one binary Yjs update per row, replayed on load.
// `createdAt` keeps its database-side default: the driver never stamps
// timestamps app-side (Date objects don't bind portably across drivers).
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
