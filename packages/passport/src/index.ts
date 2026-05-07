import { ServiceProvider, config } from '@rudderjs/core'

// ─── Re-exports ───────────────────────────────────────────

export { Passport } from './Passport.js'
export type { PassportScope, AuthorizationViewContext, AuthorizationViewFn } from './Passport.js'

export { createToken, verifyToken, unsafeDecodeToken, decodeToken } from './token.js'
export type { JwtHeader, JwtPayload, VerifyTokenOptions } from './token.js'

export { OAuthClient } from './models/OAuthClient.js'
export { AccessToken } from './models/AccessToken.js'
export { RefreshToken } from './models/RefreshToken.js'
export { AuthCode } from './models/AuthCode.js'
export { DeviceCode } from './models/DeviceCode.js'

export { BearerMiddleware, RequireBearer } from './middleware/bearer.js'
export { scope, scopeAny } from './middleware/scope.js'

export { generateKeys } from './commands/keys.js'
export { createClient, resolveClientGrantTypes } from './commands/client.js'
export type { CreateClientOpts } from './commands/client.js'
export { purgeTokens } from './commands/purge.js'
export { hashClientSecret, verifyClientSecret } from './client-secret.js'
export { hashDeviceSecret } from './device-code-secret.js'
export { hashOpaqueToken, newOpaqueToken } from './opaque-token.js'

// Grants
export {
  issueTokens,
  validateAuthorizationRequest,
  issueAuthCode,
  exchangeAuthCode,
  validateScopes,
  OAuthError,
  clientCredentialsGrant,
  refreshTokenGrant,
  requestDeviceCode,
  approveDeviceCode,
  pollDeviceCode,
} from './grants/index.js'
export type {
  IssuedTokens,
  AuthorizationRequest,
  ValidatedAuthRequest,
  TokenExchangeRequest,
  ClientCredentialsRequest,
  RefreshTokenRequest,
  DeviceAuthorizationResponse,
  DevicePollResult,
} from './grants/index.js'

// Personal access tokens
export { HasApiTokens, resetPersonalAccessClient } from './personal-access-tokens.js'
export type { NewPersonalAccessToken } from './personal-access-tokens.js'

// Routes
export { registerPassportRoutes, registerPassportWebRoutes, registerPassportApiRoutes } from './routes.js'
export type { PassportRouteOptions, PassportRouteGroup } from './routes.js'

// ─── Config ───────────────────────────────────────────────

export interface PassportConfig {
  /** Directory where RSA keys are stored (default: 'storage') */
  keyPath?: string
  /** Or set keys directly from env vars */
  privateKey?: string
  publicKey?: string
  /** Access token lifetime in ms (default: 15 days) */
  tokensExpireIn?: number
  /** Refresh token lifetime in ms (default: 30 days) */
  refreshTokensExpireIn?: number
  /** Personal access token lifetime in ms (default: ~6 months) */
  personalAccessTokensExpireIn?: number
  /** OAuth scopes: { scopeId: 'description' } */
  scopes?: Record<string, string>
  /**
   * JWT issuer URL. When set, `createToken()` stamps it as the `iss` claim
   * on every new access token, and `BearerMiddleware`/`RequireBearer` ask
   * `verifyToken()` to reject tokens whose `iss` claim doesn't match.
   * Tokens minted before this is configured carry no `iss` and pass
   * verification (legacy migration window). Recommended once a deployment
   * has more than one possible signer (multi-tenant, staging+prod sharing
   * keys). RFC 8725 §3.10.
   */
  issuer?: string
}

// ─── Service Provider ─────────────────────────────────────

export class PassportProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    const { Passport } = await import('./Passport.js')

    const cfg = config<PassportConfig>('passport')

    // Configure keys
    if (cfg.privateKey && cfg.publicKey) {
      Passport.setKeys(cfg.privateKey, cfg.publicKey)
    } else if (cfg.keyPath) {
      Passport.loadKeysFrom(cfg.keyPath)
    }

    // Surface a startup warning when no keys are reachable — env vars
    // unset AND no keypair on disk under the configured path. Without this,
    // the first `/oauth/*` request fails deep inside `Passport.keys()` with
    // a generic ENOENT that doesn't point at the missing-bootstrap-step.
    if (!(await Passport.keysAvailable())) {
      console.warn(
        `[@rudderjs/passport] No RSA keypair found at "${Passport.keyPath()}/oauth-{private,public}.key" ` +
        `and no PASSPORT_PRIVATE_KEY / PASSPORT_PUBLIC_KEY env vars set. ` +
        `Run \`rudder passport:keys\` to generate one — token issuance and verification will fail until keys are present.`
      )
    }

    // Configure lifetimes
    if (cfg.tokensExpireIn) Passport.tokensExpireIn(cfg.tokensExpireIn)
    if (cfg.refreshTokensExpireIn) Passport.refreshTokensExpireIn(cfg.refreshTokensExpireIn)
    if (cfg.personalAccessTokensExpireIn) Passport.personalAccessTokensExpireIn(cfg.personalAccessTokensExpireIn)

    // Configure scopes
    if (cfg.scopes) Passport.tokensCan(cfg.scopes)

    // Configure issuer (P7) — see PassportConfig.issuer jsdoc.
    if (cfg.issuer) Passport.useIssuer(cfg.issuer)

    this.app.instance('passport', Passport)

    // Register the four token models with the ORM ModelRegistry so the
    // `model:prune` scheduler picks up their `static prunable()` definitions
    // on day-1 fresh apps — without this, the registry only learns about
    // the models lazily on the first oauth flow that hits them, so a fresh
    // install running `model:prune` before any client/token activity would
    // silently skip passport rows. Resolves through the `Passport.*Model()`
    // accessors so app-level model overrides (`Passport.useTokenModel(...)`)
    // are respected.
    const { ModelRegistry } = await import('@rudderjs/orm')
    ModelRegistry.register(await Passport.clientModel())
    ModelRegistry.register(await Passport.tokenModel())
    ModelRegistry.register(await Passport.refreshTokenModel())
    ModelRegistry.register(await Passport.authCodeModel())
    ModelRegistry.register(await Passport.deviceCodeModel())

    // Register CLI commands. `@rudderjs/core` (which re-exports `rudder`)
    // and `@rudderjs/console` (which exports `registerMakeSpecs`) are both
    // hard deps via the `@rudderjs/core` → `@rudderjs/console` dependency
    // chain, so the dynamic imports are guaranteed to resolve. We do NOT
    // wrap registration in a catch-all — duplicate-registration bugs after
    // HMR or stub-validation errors should surface, not get swallowed
    // under a misleading "rudder not available" comment.
    const { rudder } = await import('@rudderjs/core')

    rudder.command('passport:keys', async (args: string[]) => {
      const force = args.includes('--force')
      const { generateKeys } = await import('./commands/keys.js')
      const { privatePath, publicPath, backup, previousPublicPath } = await generateKeys({ force })
      console.log(`  RSA keys generated:`)
      console.log(`    Private: ${privatePath}`)
      console.log(`    Public:  ${publicPath}`)
      if (backup) {
        console.log(`  Previous keys backed up to:`)
        console.log(`    Private: ${backup.privatePath}`)
        console.log(`    Public:  ${backup.publicPath}`)
        if (previousPublicPath) {
          console.log(`  Previous public key retained for grace verification at:`)
          console.log(`    ${previousPublicPath}`)
          console.log(`  JWTs signed by the old key continue verifying until they expire.`)
          console.log(`  Delete this file once the old tokens have expired to drop the grace window.`)
        }
      }
    }).description('Generate RSA encryption keys for OAuth tokens')

    rudder.command('passport:client', async (args: string[]) => {
      const name = args[0] ?? 'My App'
      const isPublic = args.includes('--public')
      const isDevice = args.includes('--device')
      const isPersonal = args.includes('--personal')
      const isM2M = args.includes('--client-credentials')

      // `--personal` previously created an OAuth client with `personal_access`
      // as the only grant type — but `personal_access` is not an HTTP grant
      // (`/oauth/token` rejects it), and personal access tokens go through
      // `HasApiTokens.createToken()` which auto-manages an internal
      // `__personal_access__` client. So the row a user got from
      // `passport:client --personal` was an orphan — present in the DB,
      // never reachable through any flow. Print a hint instead of creating
      // it; this is a CLI ergonomics fix, no user-data migration needed.
      if (isPersonal) {
        console.log('Personal access tokens don\'t need a hand-rolled OAuth client.')
        console.log('They\'re minted by HasApiTokens.createToken() against an auto-managed')
        console.log('internal client; mix `HasApiTokens` into your User model and call:')
        console.log('')
        console.log('  const { plainTextToken } = await user.createToken(\'cli\', [\'read\'])')
        console.log('')
        console.log('See packages/passport/CLAUDE.md for the full setup.')
        return
      }

      const { createClient, resolveClientGrantTypes } = await import('./commands/client.js')
      const grantTypes = resolveClientGrantTypes({ isDevice, isM2M })
      const { client, secret } = await createClient({
        name,
        confidential: !isPublic && !isDevice,
        grantTypes,
      })

      console.log(`  OAuth client created:`)
      console.log(`    Client ID: ${client.id}`)
      console.log(`    Name:      ${client.name}`)
      if (secret) {
        console.log(`    Secret:    ${secret}`)
        console.log(`    (Store this secret — it won't be shown again.)`)
      }
    }).description('Create a new OAuth client')

    rudder.command('passport:purge', async () => {
      const { purgeTokens } = await import('./commands/purge.js')
      const counts = await purgeTokens()
      const total = counts.accessTokens + counts.refreshTokens + counts.authCodes + counts.deviceCodes
      console.log(`  Purged ${total} expired/revoked record(s):`)
      console.log(`    Access tokens:  ${counts.accessTokens}`)
      console.log(`    Refresh tokens: ${counts.refreshTokens}`)
      console.log(`    Auth codes:     ${counts.authCodes}`)
      console.log(`    Device codes:   ${counts.deviceCodes}`)
    }).description('Remove expired tokens and auth codes')

    // Register make:* scaffolder for passport
    const { registerMakeSpecs } = await import('@rudderjs/console')
    registerMakeSpecs({
      command:     'make:passport-client',
      description: 'Create a new OAuth client seeder',
      label:       'Passport client seeder created',
      directory:   'app/Seeders',
      stub: (className) => `import { createClient } from '@rudderjs/passport'

export async function ${className.replace(/Seeder$/, '').toLowerCase()}Clients(): Promise<void> {
  // Create a confidential client (server-side apps)
  const { client, secret } = await createClient({
    name: 'My Application',
    redirectUri: 'http://localhost:3000/callback',
    grantTypes: ['authorization_code', 'refresh_token'],
  })
  console.log('Client ID:', client.id)
  console.log('Secret:', secret)
}
`,
    })
  }
}
