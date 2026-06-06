import { Migration, Schema } from '@rudderjs/orm/native'

// The auth users table — same shape the create-rudder native scaffold ships.
// Password reset tokens are stateless (HMAC via AUTH_SECRET), so no
// password_reset_tokens table is needed.
export default class extends Migration {
  async up() {
    await Schema.create('users', (t) => {
      t.id()
      t.string('name')
      t.string('email').unique()
      t.string('password').nullable()
      t.dateTime('emailVerifiedAt').nullable()
      t.string('image').nullable()
      t.string('role').default('user')
      t.string('rememberToken').nullable()
      t.dateTime('createdAt').useCurrent()
      t.dateTime('updatedAt').useCurrent()
    })
  }

  async down() {
    await Schema.dropIfExists('users')
  }
}
