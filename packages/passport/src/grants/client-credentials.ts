import { Passport } from '../Passport.js'
import type { OAuthClient } from '../models/OAuthClient.js'
import { clientHelpers } from '../models/helpers.js'
import { issueTokens, type IssuedTokens } from './issue-tokens.js'
import { OAuthError, validateScopes } from './authorization-code.js'
import { parseScopes } from './parse-scopes.js'
import { verifyConfidentialCredentials } from './verify-client.js'

export interface ClientCredentialsRequest {
  grantType:    string
  clientId:     string
  clientSecret: string
  scope?:       string
}

/**
 * Client credentials grant — machine-to-machine, no user context.
 * Issues an access token (no refresh token).
 */
export async function clientCredentialsGrant(params: ClientCredentialsRequest): Promise<IssuedTokens> {
  if (params.grantType !== 'client_credentials') {
    throw new OAuthError('unsupported_grant_type', 'Expected grant_type=client_credentials.')
  }

  const ClientCls = await Passport.clientModel()
  const client = await ClientCls.where('id', params.clientId).first() as OAuthClient | null
  if (!client || client.revoked) {
    throw new OAuthError('invalid_client', 'Client not found.', 401)
  }

  if (!clientHelpers.hasGrantType(client, 'client_credentials')) {
    throw new OAuthError('unauthorized_client', 'Client is not authorized for client_credentials grant.')
  }

  await verifyConfidentialCredentials(client, params.clientSecret, { requireConfidential: true })

  const scopes = parseScopes(params.scope)
  validateScopes(client, scopes)

  return issueTokens({
    userId:         null, // no user context
    clientId:       params.clientId,
    scopes,
    includeRefresh: false, // client credentials don't get refresh tokens
  })
}
