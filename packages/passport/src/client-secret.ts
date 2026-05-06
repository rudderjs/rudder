import { safeCompare } from './grants/safe-compare.js'

/**
 * Hashing + verification of OAuth client secrets at rest.
 *
 * Two storage formats are supported:
 *
 *   - **Peppered** — `peppered:<HMAC-SHA256(secret, APP_KEY)>` (hex). Used
 *     when `APP_KEY` is set at the time the client is created. A leaked DB
 *     dump alone cannot be used to verify candidate secrets without also
 *     knowing `APP_KEY`.
 *   - **Plain SHA-256** — bare 64-char hex digest. Used when `APP_KEY` is
 *     unset. This matches the historical (pre-2026-05) format and is what
 *     Laravel Passport stores; client secrets are 256-bit CSPRNG so the
 *     hash adds little cryptographic protection beyond defense-in-depth.
 *
 * The format is self-describing via the `peppered:` prefix, so existing
 * rows minted before this change keep verifying against their plain
 * SHA-256 hashes — there is no migration step. New rows use whichever
 * format is available at creation time.
 *
 * Rotating `APP_KEY` invalidates every peppered client secret, the same
 * way rotating the RSA keypair invalidates every live access token. The
 * fallback path is to re-issue secrets via `passport:client` after the
 * rotation; legacy plain-SHA-256 rows are unaffected.
 */

const PEPPERED_PREFIX = 'peppered:'

function appKey(): string | null {
  const key = process.env['APP_KEY']
  return key && key.length > 0 ? key : null
}

/**
 * Hash a plain-text client secret for storage. Returns a peppered HMAC if
 * `APP_KEY` is set, otherwise a plain SHA-256 hex digest.
 */
export async function hashClientSecret(plainSecret: string): Promise<string> {
  const { createHash, createHmac } = await import('node:crypto')
  const pepper = appKey()
  if (pepper) {
    const mac = createHmac('sha256', pepper).update(plainSecret).digest('hex')
    return `${PEPPERED_PREFIX}${mac}`
  }
  return createHash('sha256').update(plainSecret).digest('hex')
}

/**
 * Verify a plain-text client secret against a stored hash. Constant-time;
 * format is auto-detected from the stored value's prefix so legacy plain
 * SHA-256 rows continue to verify after `APP_KEY` is configured.
 */
export async function verifyClientSecret(
  plainSecret: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false

  const { createHash, createHmac } = await import('node:crypto')

  if (stored.startsWith(PEPPERED_PREFIX)) {
    const pepper = appKey()
    if (!pepper) return false
    const mac = createHmac('sha256', pepper).update(plainSecret).digest('hex')
    return safeCompare(mac, stored.slice(PEPPERED_PREFIX.length))
  }

  const hashed = createHash('sha256').update(plainSecret).digest('hex')
  return safeCompare(hashed, stored)
}
