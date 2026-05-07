import { Passport } from './Passport.js'

// ─── JWT Types ────────────────────────────────────────────

export interface JwtHeader {
  alg: 'RS256'
  typ: 'JWT'
  /**
   * Key ID — SHA-256 fingerprint (base64url) of the public key that verifies
   * this token's signature. Stamped by `createToken()` on every new JWT so
   * `verifyToken()` can pick the right public key directly during a key-
   * rotation grace window. Legacy tokens minted before this PR have no
   * `kid` and fall through to "try each verification key in order" — same
   * compat pattern as `iss` (P7) and the at-rest hashing migrations.
   */
  kid?: string
}

export interface JwtPayload {
  /** Token ID */
  jti:     string
  /** Subject — user ID (null for client credentials) */
  sub:     string | null
  /** Audience — client ID */
  aud:     string
  /**
   * Issuer — set when `Passport.useIssuer(url)` was configured at the time
   * the token was minted. Optional because tokens issued before issuer
   * configuration carry no `iss` claim (legacy compat window). RFC 7519
   * §4.1.1 makes `iss` optional; we treat it as RECOMMENDED in deployments
   * that may have multiple signers (RFC 8725 §3.10).
   */
  iss?:    string
  /** Issued at (seconds) */
  iat:     number
  /** Expiration (seconds) */
  exp:     number
  /** Scopes */
  scopes:  string[]
}

/** Options for `verifyToken()` — see jsdoc on the function. */
export interface VerifyTokenOptions {
  /**
   * Expected audience (clientId). When provided, `verifyToken` rejects
   * tokens whose `aud` claim doesn't match. Resource servers that gate to
   * a specific client should always pass this. Mitigates cross-client
   * token confusion in multi-client deployments.
   */
  expectedAud?: string
  /**
   * Expected issuer URL. When provided, `verifyToken` rejects tokens whose
   * `iss` claim doesn't match. Tokens minted before issuer configuration
   * carry no `iss` claim and are exempt during the migration window —
   * same pattern as redirect_uri (P1) and familyId (P4). Pass
   * `Passport.issuer() ?? undefined` to opt in once configured.
   */
  expectedIssuer?: string
}

// ─── Helpers ──────────────────────────────────────────────

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  return buf.toString('base64url')
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf8')
}

/**
 * Stable key id for an RSA public key — SHA-256 (base64url) of the PEM
 * string verbatim. Cheaper than RFC 7638 JWK Thumbprint (no DER reparse)
 * and good enough for our single-issuer / few-keys scenarios — we only
 * need a tiebreaker between current and previous public key.
 */
async function publicKeyFingerprint(publicKeyPem: string): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(publicKeyPem).digest('base64url')
}

// ─── Create JWT ───────────────────────────────────────────

/**
 * Create a signed JWT using RSA-SHA256.
 * Uses the private key from Passport configuration.
 */
export async function createToken(payload: {
  tokenId:  string
  userId:   string | null
  clientId: string
  scopes:   string[]
  expiresAt: Date
  /**
   * Optional `iat` source in ms. When the caller (e.g. `issueTokens`) has
   * already snapshotted wall-clock time to derive `expiresAt` and `expires_in`,
   * passing the same `now` in here keeps `iat`, `exp`, and the API-level
   * `expires_in` aligned to a single instant. Defaults to `Date.now()` so
   * direct callers don't have to think about it.
   */
  iatMs?:   number
}): Promise<string> {
  const { createSign } = await import('node:crypto')
  const { privateKey, publicKey } = await Passport.keys()

  // `kid` lets verifyToken pick the right public key during a key-rotation
  // grace window without trial-and-error verification. Always stamp it on
  // new tokens — legacy tokens (no kid) still verify, just less efficiently.
  const kid = await publicKeyFingerprint(publicKey)
  const header: JwtHeader = { alg: 'RS256', typ: 'JWT', kid }

  const iat = Math.floor((payload.iatMs ?? Date.now()) / 1000)
  const jwtPayload: JwtPayload = {
    jti:    payload.tokenId,
    sub:    payload.userId,
    aud:    payload.clientId,
    iat,
    exp:    Math.floor(payload.expiresAt.getTime() / 1000),
    scopes: payload.scopes,
  }
  // Stamp `iss` only when the operator has configured one — keeps the
  // payload identical for apps that haven't opted in (no surprise size
  // bump on the wire) and keeps legacy verifiers working.
  const issuer = Passport.issuer()
  if (issuer) jwtPayload.iss = issuer

  const segments = [
    base64url(JSON.stringify(header)),
    base64url(JSON.stringify(jwtPayload)),
  ]

  const signingInput = segments.join('.')
  const sign = createSign('RSA-SHA256')
  sign.update(signingInput)
  const signature = sign.sign(privateKey, 'base64url')

  return `${signingInput}.${signature}`
}

// ─── Verify JWT ───────────────────────────────────────────

/**
 * Verify and decode a JWT using RSA-SHA256.
 * Returns the payload if valid, throws if invalid.
 *
 * Validation runs in this order — each step throws with a specific message
 * so callers can distinguish failure modes if they want to:
 *   1. Format         — three base64url-encoded segments.
 *   2. Signature      — RSA-SHA256 verifies against the configured public key.
 *   3. Expiration     — `exp` claim is in the future.
 *   4. Audience       — only when `options.expectedAud` is provided; rejects
 *                       tokens whose `aud` claim doesn't match. Mitigates
 *                       cross-client token confusion.
 *   5. Issuer         — only when `options.expectedIssuer` is provided AND
 *                       the token carries an `iss` claim; rejects mismatches.
 *                       Tokens minted before `Passport.useIssuer(...)` was
 *                       configured carry no `iss` and are exempt during the
 *                       migration window — same pattern as redirect_uri /
 *                       familyId rollouts.
 */
export async function verifyToken(jwt: string, options?: VerifyTokenOptions): Promise<JwtPayload> {
  const { createVerify } = await import('node:crypto')

  const parts = jwt.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 segments')
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string]

  // Walk every public key the operator has marked verifiable — current key
  // first, then any previous keys retained for the post-rotation grace
  // window. When the JWT carries a `kid` header we pick the matching key
  // directly; otherwise we try each in order. Either way, ONE successful
  // verify is enough — most tokens hit on the current key.
  const verificationKeys = await Passport.verificationKeys()
  const header = JSON.parse(base64urlDecode(headerB64)) as JwtHeader
  const signingInput = `${headerB64}.${payloadB64}`

  let candidates: string[]
  if (header.kid) {
    const fingerprints = await Promise.all(verificationKeys.map(publicKeyFingerprint))
    const idx = fingerprints.indexOf(header.kid)
    candidates = idx >= 0 ? [verificationKeys[idx]!] : []
  } else {
    candidates = verificationKeys
  }

  let valid = false
  for (const pk of candidates) {
    const verify = createVerify('RSA-SHA256')
    verify.update(signingInput)
    if (verify.verify(pk, signatureB64, 'base64url')) {
      valid = true
      break
    }
  }

  if (!valid) {
    throw new Error('Invalid JWT: signature verification failed')
  }

  // Decode payload
  const payload = JSON.parse(base64urlDecode(payloadB64)) as JwtPayload

  // Check expiration
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp <= now) {
    throw new Error('Invalid JWT: token has expired')
  }

  // Check audience (RFC 7519 §4.1.3 + RFC 8725 §3.10).
  if (options?.expectedAud !== undefined && payload.aud !== options.expectedAud) {
    throw new Error('Invalid JWT: audience mismatch')
  }

  // Check issuer (RFC 7519 §4.1.1 + RFC 8725 §3.10). Tokens without an
  // `iss` claim were minted before the issuer was configured — accept them
  // during the migration window. New tokens issued after `Passport.useIssuer`
  // is set carry the claim, and the verifier rejects mismatches.
  if (options?.expectedIssuer !== undefined && payload.iss !== undefined && payload.iss !== options.expectedIssuer) {
    throw new Error('Invalid JWT: issuer mismatch')
  }

  return payload
}

// ─── Decode without verification (for inspection) ─────────

/**
 * Decode a JWT payload **without verifying the signature**. The returned
 * `sub` / `aud` / `scopes` claims MUST NOT be trusted for authentication
 * decisions — an attacker can mint a JWT with any payload, sign it with
 * their own key, and this function will happily decode it.
 *
 * Legitimate uses are read-only and signature-independent — e.g. reading
 * `jti` to look up a DB row for revocation check, or peeking at `exp` for
 * client-side scheduling. Anything resembling an auth gate must call
 * `verifyToken()` instead.
 *
 * Naming convention: prefixed `unsafe` so a grep for "auth check" never
 * accidentally lands on a verification-free path. `decodeToken` is kept
 * as a deprecated alias for back-compat — see below.
 */
export function unsafeDecodeToken(jwt: string): JwtPayload {
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 segments')
  }
  return JSON.parse(base64urlDecode(parts[1]!)) as JwtPayload
}

/**
 * @deprecated Renamed to `unsafeDecodeToken`. The old name doesn't carry
 * the security warning the function deserves — callers regularly mistake
 * "decode" for "verify". Will be kept indefinitely as a thin alias for
 * back-compat; new code should import `unsafeDecodeToken`.
 */
export const decodeToken = unsafeDecodeToken
