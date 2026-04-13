import { ServiceProvider, config } from '@rudderjs/core'

// ─── Re-exports ───────────────────────────────────────────

export { Passport } from './Passport.js'
export type { PassportScope } from './Passport.js'

export { createToken, verifyToken, decodeToken } from './token.js'
export type { JwtHeader, JwtPayload } from './token.js'

export { OAuthClient } from './models/OAuthClient.js'
export { AccessToken } from './models/AccessToken.js'
export { RefreshToken } from './models/RefreshToken.js'
export { AuthCode } from './models/AuthCode.js'
export { DeviceCode } from './models/DeviceCode.js'

export { BearerMiddleware, RequireBearer } from './middleware/bearer.js'
export { scope } from './middleware/scope.js'

export { generateKeys } from './commands/keys.js'
export { createClient } from './commands/client.js'
export type { CreateClientOpts } from './commands/client.js'
export { purgeTokens } from './commands/purge.js'

// Grants
export {
  issueTokens,
  validateAuthorizationRequest,
  issueAuthCode,
  exchangeAuthCode,
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
export { registerPassportRoutes } from './routes.js'
export type { PassportRouteOptions } from './routes.js'

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

    // Configure lifetimes
    if (cfg.tokensExpireIn) Passport.tokensExpireIn(cfg.tokensExpireIn)
    if (cfg.refreshTokensExpireIn) Passport.refreshTokensExpireIn(cfg.refreshTokensExpireIn)
    if (cfg.personalAccessTokensExpireIn) Passport.personalAccessTokensExpireIn(cfg.personalAccessTokensExpireIn)

    // Configure scopes
    if (cfg.scopes) Passport.tokensCan(cfg.scopes)

    this.app.instance('passport', Passport)

    // Register CLI commands
    try {
      const { rudder } = await import('@rudderjs/core')

      rudder.command('passport:keys', async (args: string[]) => {
        const force = args.includes('--force')
        const { generateKeys } = await import('./commands/keys.js')
        const { privatePath, publicPath } = await generateKeys({ force })
        console.log(`  RSA keys generated:`)
        console.log(`    Private: ${privatePath}`)
        console.log(`    Public:  ${publicPath}`)
      }).description('Generate RSA encryption keys for OAuth tokens')

      rudder.command('passport:client', async (args: string[]) => {
        const name = args[0] ?? 'My App'
        const isPublic = args.includes('--public')
        const isDevice = args.includes('--device')
        const isPersonal = args.includes('--personal')
        const isM2M = args.includes('--client-credentials')

        const grantTypes = isDevice
          ? ['urn:ietf:params:oauth:grant-type:device_code']
          : isPersonal
            ? ['personal_access']
            : isM2M
              ? ['client_credentials']
              : ['authorization_code', 'refresh_token']

        const { createClient } = await import('./commands/client.js')
        const { client, secret } = await createClient({
          name,
          confidential: !isPublic && !isDevice,
          grantTypes,
        })

        console.log(`  OAuth client created:`)
        console.log(`    Client ID: ${(client as any).id}`)
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
      try {
        const { registerMakeSpecs } = await import('@rudderjs/rudder')
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
  console.log('Client ID:', (client as any).id)
  console.log('Secret:', secret)
}
`,
        })
      } catch { /* rudder not available */ }
    } catch { /* rudder not available */ }
  }
}
