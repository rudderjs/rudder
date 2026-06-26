import type { VerifyToken, VerifiedToken } from '@gemstack/mcp'

/**
 * Bridges `@rudderjs/passport` to the core's framework-neutral
 * {@link VerifyToken} seam. The core `oauth2McpMiddleware` no longer knows about
 * passport; the binding supplies this verifier so a Rudder app's OAuth-protected
 * MCP endpoints keep validating Passport-issued bearer tokens (signature via
 * `verifyToken`, revocation via the `AccessToken` store) exactly as before.
 */

/** @internal — exported for the verifier test seam. */
export interface PassportModule {
  verifyToken: (jwt: string) => Promise<{
    jti: string
    sub?: string
    scopes?: string[]
  }>
  AccessToken: {
    query(): {
      where(field: string, value: unknown): {
        first(): Promise<{ id: string; revoked: boolean } | null>
      }
    }
  }
}

let passportPromise: Promise<PassportModule> | null = null

/**
 * @internal — test-only seam. Replaces the memoised passport module with the
 * provided fake (or clears it). Returns a restore function.
 */
export function _setPassportForTest(m: PassportModule | null): () => void {
  const prev = passportPromise
  passportPromise = m ? Promise.resolve(m) : null
  return () => { passportPromise = prev }
}

/**
 * Lazy-load `@rudderjs/passport` once per process via the Rudder optional-peer
 * resolver. Memoised; on failure the slot is cleared so the next caller retries.
 */
function loadPassport(): Promise<PassportModule> {
  if (!passportPromise) {
    passportPromise = (async () => {
      const { resolveOptionalPeer } = await import('@rudderjs/core')
      return resolveOptionalPeer<PassportModule>('@rudderjs/passport')
    })().catch((err) => {
      passportPromise = null
      throw err
    })
  }
  return passportPromise
}

/**
 * Build a {@link VerifyToken} backed by `@rudderjs/passport`. Throws (so the
 * core middleware answers 401) with a descriptive message on each failure mode:
 * provider not configured, invalid/expired token, verification error, or a
 * revoked token (message includes "revoked" so the challenge stays informative).
 */
export function makePassportVerifier(): VerifyToken {
  return async function passportVerifyToken(jwt: string): Promise<VerifiedToken | null> {
    let passport: PassportModule
    try {
      passport = await loadPassport()
    } catch {
      throw new Error('OAuth provider not configured.')
    }

    let payload: Awaited<ReturnType<PassportModule['verifyToken']>>
    try {
      payload = await passport.verifyToken(jwt)
    } catch {
      throw new Error('Invalid or expired token.')
    }

    let token: { id: string; revoked: boolean } | null
    try {
      token = await passport.AccessToken.query().where('id', payload.jti).first()
    } catch {
      throw new Error('Token could not be verified.')
    }
    if (!token || token.revoked) {
      throw new Error('Token has been revoked.')
    }

    const claims: VerifiedToken = {}
    if (payload.sub !== undefined) claims['sub'] = payload.sub
    if (payload.scopes !== undefined) claims['scopes'] = payload.scopes
    return claims
  }
}
