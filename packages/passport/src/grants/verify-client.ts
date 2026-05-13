import type { OAuthClient } from '../models/OAuthClient.js'
import { verifyClientSecret } from '../client-secret.js'
import { OAuthError } from './authorization-code.js'

/**
 * Verify client credentials at the token endpoint per RFC 6749 §2.3 / §5.2.
 *
 * Three failure modes return `invalid_client` 401 (with `WWW-Authenticate`
 * set by the route handler on 401 responses):
 *
 *   1. **Missing secret** for a confidential client. The token endpoint
 *      requires a credential pair from confidential clients regardless of
 *      grant flow.
 *   2. **`client.secret == null` on a confidential client.** The schema
 *      allows the column to be null (public clients legitimately have no
 *      secret). Hitting this branch on a confidential client is a data
 *      anomaly — explicit guard so a future refactor can't mask
 *      `secret = null` as authenticating against `verifyClientSecret(_, null)`
 *      (which fail-closes today, but the contract should be obvious).
 *   3. **Hash mismatch.** Constant-time compare inside `verifyClientSecret`.
 *
 * `opts.requireConfidential` rejects non-confidential clients up front
 * (`client_credentials` grant — RFC 6749 §4.4). Auth-code and refresh-token
 * grants accept either kind; the credential pair is only checked when
 * `client.confidential === true`. Public clients with no secret skip
 * verification entirely and rely on PKCE / refresh-token-rotation for
 * binding.
 */
export async function verifyConfidentialCredentials(
  client: OAuthClient,
  clientSecret: string | undefined,
  opts: { requireConfidential?: boolean } = {},
): Promise<void> {
  if (opts.requireConfidential && !client.confidential) {
    throw new OAuthError('invalid_client', 'Client credentials grant requires a confidential client.')
  }

  if (!client.confidential) return

  if (!clientSecret) {
    throw new OAuthError('invalid_client', 'Client secret required.', 401)
  }
  if (client.secret == null) {
    throw new OAuthError('invalid_client', 'Confidential client has no secret on file.', 401)
  }
  if (!(await verifyClientSecret(clientSecret, client.secret))) {
    throw new OAuthError('invalid_client', 'Invalid client secret.', 401)
  }
}
