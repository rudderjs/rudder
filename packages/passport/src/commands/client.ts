import { Passport } from '../Passport.js'
import { hashClientSecret } from '../client-secret.js'
import type { OAuthClient } from '../models/OAuthClient.js'

export interface CreateClientOpts {
  name:         string
  redirectUri?: string
  grantTypes?:  string[]
  confidential?: boolean
}

/**
 * Resolve the grant-types array for a `passport:client` invocation, given
 * the parsed CLI flags. Pure — exported so the CLI handler stays a thin
 * wrapper and the flag → array mapping is unit-testable.
 *
 *   - `--device`  → `['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']`
 *     (RFC 8628 doesn't mandate a fixed grant list; pairing `refresh_token`
 *      with the device flow is the expected default — without it, the
 *      tokens minted by polling can't be refreshed.)
 *   - `--client-credentials` → `['client_credentials']`
 *   - default → `['authorization_code', 'refresh_token']`
 *
 * `--personal` is intentionally NOT a case here — personal access tokens
 * don't need a CLI-created OAuth client. `passport:client` short-circuits
 * before this resolver runs and prints a hint pointing at
 * `HasApiTokens.createToken()` instead.
 */
export function resolveClientGrantTypes(flags: { isDevice?: boolean; isM2M?: boolean }): string[] {
  if (flags.isDevice) return ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']
  if (flags.isM2M)    return ['client_credentials']
  return ['authorization_code', 'refresh_token']
}

/**
 * Create an OAuth client programmatically.
 * Returns the client and the plain-text secret (if confidential).
 */
export async function createClient(opts: CreateClientOpts): Promise<{
  client: OAuthClient
  secret: string | null
}> {
  const { randomBytes } = await import('node:crypto')

  const confidential = opts.confidential ?? true
  let plainSecret: string | null = null
  let hashedSecret: string | null = null

  if (confidential) {
    plainSecret = randomBytes(32).toString('hex')
    hashedSecret = await hashClientSecret(plainSecret)
  }

  const ClientCls = await Passport.clientModel()
  const client = await ClientCls.create({
    name:         opts.name,
    secret:       hashedSecret,
    redirectUris: JSON.stringify(opts.redirectUri ? [opts.redirectUri] : []),
    grantTypes:   JSON.stringify(opts.grantTypes ?? ['authorization_code']),
    scopes:       JSON.stringify([]),
    confidential,
  } as Record<string, unknown>) as OAuthClient

  return { client, secret: plainSecret }
}
