/**
 * Opaque-token generation + hashing for `oauth_refresh_tokens` and
 * `oauth_auth_codes`.
 *
 * Both tables store the credential as `tokenHash` (SHA-256 of the plaintext)
 * with the plaintext returned to the client only once at issuance and never
 * persisted. A DB read leak yields hashes, not usable bearer credentials.
 *
 * Same plain-SHA-256 reasoning as `device-code-secret.ts`:
 *
 * - The plaintext is `randomBytes(48).toString('base64url')` — 384 bits CSPRNG.
 *   Already unguessable per request; pepper would buy nothing.
 * - The threat being mitigated is **DB read leak**: a `SELECT *` on
 *   `oauth_refresh_tokens` / `oauth_auth_codes` should not yield credentials
 *   that an attacker can replay against `/oauth/token`.
 * - Constant-time compare is implicit via the `@unique` index lookup —
 *   the application layer hashes the inbound plaintext, then equality-matches
 *   on the indexed column. The B-tree probe on a 64-char hash is not a
 *   useful timing side channel.
 *
 * This helper is intentionally separate from `device-code-secret.ts` because
 * the threat-model commentary differs (device codes have a 15-minute TTL +
 * api-group rate limiting; refresh tokens are long-lived). Keeping the docs
 * close to the use site avoids confusing future readers about which surface
 * this applies to.
 *
 * Lazy-loads `node:crypto` so the package stays importable from non-Node
 * runtimes that never reach this code path.
 */
export async function newOpaqueToken(): Promise<string> {
  const { randomBytes } = await import('node:crypto')
  return randomBytes(48).toString('base64url')
}

export async function hashOpaqueToken(plaintext: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(plaintext).digest('hex')
}
