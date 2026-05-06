import { Passport } from './Passport.js'

// ─── JWT Types ────────────────────────────────────────────

export interface JwtHeader {
  alg: 'RS256'
  typ: 'JWT'
}

export interface JwtPayload {
  /** Token ID */
  jti:     string
  /** Subject — user ID (null for client credentials) */
  sub:     string | null
  /** Audience — client ID */
  aud:     string
  /** Issued at (seconds) */
  iat:     number
  /** Expiration (seconds) */
  exp:     number
  /** Scopes */
  scopes:  string[]
}

// ─── Helpers ──────────────────────────────────────────────

function base64url(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  return buf.toString('base64url')
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf8')
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
  const { privateKey } = await Passport.keys()

  const header: JwtHeader = { alg: 'RS256', typ: 'JWT' }

  const iat = Math.floor((payload.iatMs ?? Date.now()) / 1000)
  const jwtPayload: JwtPayload = {
    jti:    payload.tokenId,
    sub:    payload.userId,
    aud:    payload.clientId,
    iat,
    exp:    Math.floor(payload.expiresAt.getTime() / 1000),
    scopes: payload.scopes,
  }

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
 */
export async function verifyToken(jwt: string): Promise<JwtPayload> {
  const { createVerify } = await import('node:crypto')
  const { publicKey } = await Passport.keys()

  const parts = jwt.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 segments')
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string]

  // Verify signature
  const signingInput = `${headerB64}.${payloadB64}`
  const verify = createVerify('RSA-SHA256')
  verify.update(signingInput)
  const valid = verify.verify(publicKey, signatureB64, 'base64url')

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

  return payload
}

// ─── Decode without verification (for inspection) ─────────

/**
 * Decode a JWT payload without verifying the signature.
 * Useful for reading token metadata (e.g., jti for revocation check).
 */
export function decodeToken(jwt: string): JwtPayload {
  const parts = jwt.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 segments')
  }
  return JSON.parse(base64urlDecode(parts[1]!)) as JwtPayload
}
