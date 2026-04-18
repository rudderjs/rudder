import { Passport } from '../Passport.js'
import type { OAuthClient } from '../models/OAuthClient.js'

export interface CreateClientOpts {
  name:         string
  redirectUri?: string
  grantTypes?:  string[]
  confidential?: boolean
}

/**
 * Create an OAuth client programmatically.
 * Returns the client and the plain-text secret (if confidential).
 */
export async function createClient(opts: CreateClientOpts): Promise<{
  client: OAuthClient
  secret: string | null
}> {
  const { randomBytes, createHash } = await import('node:crypto')

  const confidential = opts.confidential ?? true
  let plainSecret: string | null = null
  let hashedSecret: string | null = null

  if (confidential) {
    plainSecret = randomBytes(32).toString('hex')
    hashedSecret = createHash('sha256').update(plainSecret).digest('hex')
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
