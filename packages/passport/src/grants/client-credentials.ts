import { Passport } from '../Passport.js'
import type { OAuthClient } from '../models/OAuthClient.js'
import { clientHelpers } from '../models/helpers.js'
import { verifyClientSecret } from '../client-secret.js'
import { issueTokens, type IssuedTokens } from './issue-tokens.js'
import { OAuthError, validateScopes } from './authorization-code.js'

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

  if (!clientHelpers.hasGrantType(client as any, 'client_credentials')) {
    throw new OAuthError('unauthorized_client', 'Client is not authorized for client_credentials grant.')
  }

  if (!client.confidential) {
    throw new OAuthError('invalid_client', 'Client credentials grant requires a confidential client.')
  }

  // Schema allows `client.secret` to be null (public clients), but reaching
  // this branch with a confidential client should always have a hashed secret
  // on file. Catching the null case explicitly prevents a future refactor
  // from masking `secret = null` as authenticating against
  // `verifyClientSecret(_, null)` (which fails closed today, but the guard
  // makes the contract obvious to readers and hardens against drift).
  if (client.secret == null) {
    throw new OAuthError('invalid_client', 'Confidential client has no secret on file.', 401)
  }

  if (!(await verifyClientSecret(params.clientSecret, client.secret))) {
    throw new OAuthError('invalid_client', 'Invalid client secret.', 401)
  }

  const scopes = params.scope ? params.scope.split(' ').filter(Boolean) : []
  validateScopes(client, scopes)

  return issueTokens({
    userId:         null, // no user context
    clientId:       params.clientId,
    scopes,
    includeRefresh: false, // client credentials don't get refresh tokens
  })
}
