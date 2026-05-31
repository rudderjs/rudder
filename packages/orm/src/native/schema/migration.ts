// ─── Migration base class (Laravel parity) ─────────────────
//
// A migration file default-exports a subclass with `up()` (apply) and `down()`
// (revert). The runner ({@link Migrator}) binds a connection to the static
// `Schema` facade, then calls `up()` / `down()` — inside which `Schema.create`,
// `Schema.drop`, etc. operate on that connection.
//
//   // database/migrations/2026_05_31_120000_create_users_table.ts
//   import { Migration, Schema } from '@rudderjs/orm/native'
//   export default class extends Migration {
//     async up()   { await Schema.create('users', (t) => { t.id(); t.string('name'); t.timestamps() }) }
//     async down() { await Schema.dropIfExists('users') }
//   }

export abstract class Migration {
  /** Apply the migration. */
  abstract up(): Promise<void> | void

  /** Revert the migration. Defaults to a no-op so a forward-only migration can
   *  omit it (rollback of such a migration then does nothing for that step). */
  down(): Promise<void> | void {}
}
