import { OAuthClient } from '../models/OAuthClient.js'
import { clientHelpers } from '../models/helpers.js'
import { issueTokens, type IssuedTokens } from './issue-tokens.js'
import { OAuthError } from './authorization-code.js'

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

  const client = await OAuthClient.where('id', params.clientId).first() as OAuthClient | null
  if (!client || client.revoked) {
    throw new OAuthError('invalid_client', 'Client not found.', 401)
  }

  if (!clientHelpers.hasGrantType(client as any, 'client_credentials')) {
    throw new OAuthError('unauthorized_client', 'Client is not authorized for client_credentials grant.')
  }

  if (!client.confidential) {
    throw new OAuthError('invalid_client', 'Client credentials grant requires a confidential client.')
  }

  // Verify secret
  const { createHash } = await import('node:crypto')
  const hashed = createHash('sha256').update(params.clientSecret).digest('hex')
  if (hashed !== client.secret) {
    throw new OAuthError('invalid_client', 'Invalid client secret.', 401)
  }

  const scopes = params.scope ? params.scope.split(' ').filter(Boolean) : []

  return issueTokens({
    userId:         null, // no user context
    clientId:       params.clientId,
    scopes,
    includeRefresh: false, // client credentials don't get refresh tokens
  })
}
