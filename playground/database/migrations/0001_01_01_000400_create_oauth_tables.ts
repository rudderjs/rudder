import { Migration, Schema } from '@rudderjs/orm/native'

// @rudderjs/passport OAuth2 tables. SQL table names + string ulid PKs match the
// passport models (which carry the @@map SQL names + `static keyType = 'ulid'`),
// so the same models run on the native engine here and on the Prisma twin.
export default class extends Migration {
  async up() {
    await Schema.create('oauth_clients', (t) => {
      t.ulid('id').primary()
      t.string('name')
      t.string('secret').nullable()
      t.text('redirectUris').default('[]')
      t.text('grantTypes').default('["authorization_code"]')
      t.text('scopes').default('[]')
      t.boolean('confidential').default(true)
      t.boolean('revoked').default(false)
      t.dateTime('createdAt').useCurrent()
      t.dateTime('updatedAt').useCurrent()
    })

    await Schema.create('oauth_access_tokens', (t) => {
      t.ulid('id').primary()
      t.string('userId').nullable().index()
      t.string('clientId')
      t.string('name').nullable()
      t.text('scopes').default('[]')
      t.boolean('revoked').default(false)
      t.dateTime('expiresAt')
      t.dateTime('createdAt').useCurrent()
    })

    await Schema.create('oauth_refresh_tokens', (t) => {
      t.ulid('id').primary()
      t.string('tokenHash').unique()
      t.string('accessTokenId').unique()
      t.string('familyId').nullable().index()
      t.boolean('revoked').default(false)
      t.dateTime('expiresAt')
    })

    await Schema.create('oauth_auth_codes', (t) => {
      t.ulid('id').primary()
      t.string('tokenHash').unique()
      t.string('userId')
      t.string('clientId')
      t.text('scopes').default('[]')
      t.boolean('revoked').default(false)
      t.dateTime('expiresAt')
      t.string('redirectUri').nullable()
      t.string('codeChallenge').nullable()
      t.string('codeChallengeMethod').nullable()
    })

    await Schema.create('oauth_device_codes', (t) => {
      t.ulid('id').primary()
      t.string('clientId')
      t.string('userCodeHash').unique()
      t.string('deviceCodeHash').unique()
      t.text('scopes').default('[]')
      t.string('userId').nullable()
      t.boolean('approved').nullable()
      t.integer('interval').default(5)
      t.dateTime('expiresAt')
      t.dateTime('lastPolledAt').nullable()
      t.dateTime('createdAt').useCurrent()
    })
  }

  async down() {
    await Schema.dropIfExists('oauth_device_codes')
    await Schema.dropIfExists('oauth_auth_codes')
    await Schema.dropIfExists('oauth_refresh_tokens')
    await Schema.dropIfExists('oauth_access_tokens')
    await Schema.dropIfExists('oauth_clients')
  }
}
