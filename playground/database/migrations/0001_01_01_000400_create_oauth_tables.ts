import { Migration, Schema } from '@rudderjs/orm/native'

// @rudderjs/passport OAuth2 tables. The passport models reference
// delegate-style table names (static table = 'oAuthClient', …), which on the
// native engine are literal SQL table names — created as such here.
export default class extends Migration {
  async up() {
    await Schema.create('oAuthClient', (t) => {
      t.id()
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

    await Schema.create('oAuthAccessToken', (t) => {
      t.id()
      t.string('userId').nullable().index()
      t.string('clientId')
      t.string('name').nullable()
      t.text('scopes').default('[]')
      t.boolean('revoked').default(false)
      t.dateTime('expiresAt')
      t.dateTime('createdAt').useCurrent()
    })

    await Schema.create('oAuthRefreshToken', (t) => {
      t.id()
      t.string('tokenHash').unique()
      t.string('accessTokenId').unique()
      t.string('familyId').nullable().index()
      t.boolean('revoked').default(false)
      t.dateTime('expiresAt')
    })

    await Schema.create('oAuthAuthCode', (t) => {
      t.id()
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

    await Schema.create('oAuthDeviceCode', (t) => {
      t.id()
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
    await Schema.dropIfExists('oAuthDeviceCode')
    await Schema.dropIfExists('oAuthAuthCode')
    await Schema.dropIfExists('oAuthRefreshToken')
    await Schema.dropIfExists('oAuthAccessToken')
    await Schema.dropIfExists('oAuthClient')
  }
}
