/**
 * SHA-256 hashing for device-flow secrets (`device_code` + `user_code`).
 *
 * Different threat model from client secrets — we don't pepper here:
 *
 * - `deviceCode` is `randomBytes(32).toString('hex')` (256 bits CSPRNG).
 *   `userCode` is 8 chars from a 32-symbol alphabet (~1.1×10^12 keyspace).
 *   Both are already unguessable per request.
 * - The threat being mitigated is **DB read leak**: an attacker with
 *   `SELECT *` access on `oauth_device_codes` should not get usable codes
 *   that they can replay against `/oauth/token` or `/oauth/device/approve`.
 *   SHA-256 of the plaintext is sufficient — the attacker can't reverse it,
 *   and brute-force by guessing the input is no easier than guessing the
 *   original code without a DB leak at all.
 * - Pepper would help against an offline attacker who learned a column hash
 *   AND could test guesses against an online endpoint. Device codes are
 *   TTL-limited (15 min) and the per-IP rate limit (#279 + the api-group
 *   default) prevents online brute force, so the pepper buys nothing.
 *
 * This is intentionally simpler than `client-secret.ts` (which DOES pepper
 * via APP_KEY) — long-lived client secrets across multiple confidential
 * clients have a different risk profile from short-lived per-flow codes.
 *
 * Lazy-loads `node:crypto` so the package stays importable from non-Node
 * runtimes that never reach this code path.
 */
export async function hashDeviceSecret(plaintext: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(plaintext).digest('hex')
}
