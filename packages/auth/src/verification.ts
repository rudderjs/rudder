import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto'
import { Url } from '@rudderjs/router'
import type { MiddlewareHandler } from '@rudderjs/contracts'
import { Auth } from './auth-manager.js'
import type { Authenticatable, AuthUser } from './contracts.js'

// ─── MustVerifyEmail ────────────────────────────────────────

/**
 * Implement on your User model to opt into email verification.
 *
 * @example
 * class User extends Model implements Authenticatable, MustVerifyEmail {
 *   hasVerifiedEmail() { return this.emailVerifiedAt !== null }
 *   async markEmailAsVerified() { await User.update(this.id, { emailVerifiedAt: new Date() }) }
 *   getEmailForVerification() { return this.email }
 * }
 */
export interface MustVerifyEmail {
  hasVerifiedEmail(): boolean
  markEmailAsVerified(): Promise<void>
  getEmailForVerification(): string
}

/** Type guard for users that must verify email. */
export function mustVerifyEmail(user: unknown): user is Authenticatable & MustVerifyEmail {
  const u = user as Record<string, unknown>
  return (
    typeof u['hasVerifiedEmail'] === 'function' &&
    typeof u['markEmailAsVerified'] === 'function' &&
    typeof u['getEmailForVerification'] === 'function'
  )
}

// ─── EnsureEmailIsVerified middleware ────────────────────────

/**
 * Middleware that requires the authenticated user to have a verified email.
 * Returns 403 if unverified.
 *
 * @example
 * import { RequireAuth, EnsureEmailIsVerified } from '@rudderjs/auth'
 * router.get('/dashboard', RequireAuth(), EnsureEmailIsVerified(), handler)
 */
export function EnsureEmailIsVerified(): MiddlewareHandler {
  return async function EnsureEmailIsVerified(req, res, next) {
    // Re-resolve via the live guard first — `req.user` is a serialized
    // snapshot produced by `userToPlain()`. The snapshot drops methods and
    // its `emailVerifiedAt` is whatever survived JSON serialization (a Date
    // becomes a string; a mass-assigned column could be anything). The live
    // Model still has typed columns AND any `MustVerifyEmail` mixin
    // contract. Fall back to the snapshot only when no auth context is set
    // (e.g. apps wiring this without `AuthMiddleware` / `RequireAuth`) or
    // the guard couldn't resolve a user but the snapshot still has one.
    let user: Authenticatable | null
    try {
      user = await Auth.user()
    } catch {
      user = null
    }
    if (!user) {
      const snapshot = (req as unknown as { user?: AuthUser }).user
      user = (snapshot ?? null) as Authenticatable | null
    }

    if (!user) {
      res.status(401).json({ message: 'Unauthorized.' })
      return
    }

    // Preferred path — the User Model implements `MustVerifyEmail`. The
    // mixin owns the truth ("is this user verified?") and rules out the
    // truthy-anything bug entirely.
    if (mustVerifyEmail(user)) {
      if (user.hasVerifiedEmail()) { await next(); return }
      res.status(403).json({ message: 'Your email address is not verified.' })
      return
    }

    // Fallback — User without the mixin. Tighten the snapshot check so a
    // mass-assigned `"false"` / `0` / non-date string can never pass.
    const verifiedAt = (user as unknown as Record<string, unknown>)['emailVerifiedAt']
    if (isVerifiedTimestamp(verifiedAt)) { await next(); return }

    res.status(403).json({ message: 'Your email address is not verified.' })
  }
}

/**
 * Verified-state predicate — accepts a real `Date` or an ISO-shaped string
 * `Date.parse` can consume. Rejects every other truthy value (the snapshot
 * could otherwise carry `"false"`, `0`, `"unverified"`, etc. through a
 * mass-assignable column and silently pass the gate).
 */
function isVerifiedTimestamp(v: unknown): boolean {
  if (v instanceof Date) return !isNaN(v.getTime())
  if (typeof v === 'string' && v.length > 0) {
    const t = Date.parse(v)
    return !isNaN(t)
  }
  return false
}

// ─── Verification URL helper ────────────────────────────────

/**
 * Generate a signed email verification URL for a user.
 * Requires `@rudderjs/router` with a named route 'verification.verify'.
 *
 * @example
 * // Register the verification route:
 * router.get('/email/verify/:id/:hash', verifyHandler, [ValidateSignature()])
 *   .name('verification.verify')
 *
 * // Generate the URL (e.g. in a notification):
 * const url = verificationUrl(user)
 */
export function verificationUrl(user: MustVerifyEmail & { id?: string | number; getAuthIdentifier?(): string }): string {
  const id    = user.getAuthIdentifier?.() ?? String((user as unknown as Record<string, unknown>)['id'] ?? '')
  const email = user.getEmailForVerification()

  // Create a hash of the email for URL validation
  const hash = _sha256(email)

  return Url.temporarySignedRoute('verification.verify', 3600, { id, hash })
}

// ─── Verify handler helper ──────────────────────────────────

/**
 * Verifies the email hash matches and marks the user as verified.
 * Use inside the verification route handler.
 *
 * @example
 * router.get('/email/verify/:id/:hash', async (req, res) => {
 *   await handleEmailVerification(req.params.id, req.params.hash, async (id) => {
 *     return User.find(id)
 *   })
 *   res.json({ message: 'Email verified.' })
 * }, [ValidateSignature()]).name('verification.verify')
 */
export async function handleEmailVerification(
  id: string,
  hash: string,
  findUser: (id: string) => Promise<(MustVerifyEmail & Record<string, unknown>) | null>,
): Promise<boolean> {
  const user = await findUser(id)
  if (!user) return false

  const email     = user.getEmailForVerification()
  const expected  = _sha256(email)

  const hashBuf     = Buffer.from(hash,     'hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  if (hashBuf.length !== expectedBuf.length || !cryptoTimingSafeEqual(hashBuf, expectedBuf)) return false

  if (!user.hasVerifiedEmail()) {
    await user.markEmailAsVerified()
  }

  return true
}

// ─── SHA-256 hash ───────────────────────────────────────────

function _sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
