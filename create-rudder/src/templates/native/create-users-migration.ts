/**
 * Starter migration for the native engine — creates the `users` and
 * `password_reset_tokens` tables that `@rudderjs/auth` expects. Mirrors the
 * prisma/drizzle auth schema, in the native `Schema` builder's fluent form.
 * Applied with `rudder migrate`, which also generates the typed schema
 * (`app/Models/__schema/registry.d.ts`).
 */
export function nativeCreateUsersMigration(): string {
  return `import { Migration, Schema } from '@rudderjs/orm/native'

export default class extends Migration {
  async up() {
    await Schema.create('users', (t) => {
      t.id()
      t.string('name')
      t.string('email').unique()
      t.string('password').nullable()
      t.dateTime('emailVerifiedAt').nullable()
      t.string('role').default('user')
      t.string('rememberToken').nullable()
      t.timestamps()
    })

    await Schema.create('password_reset_tokens', (t) => {
      t.string('email').primary()
      t.string('token')
      t.timestamp('createdAt').nullable()
    })
  }

  async down() {
    await Schema.dropIfExists('password_reset_tokens')
    await Schema.dropIfExists('users')
  }
}
`
}
