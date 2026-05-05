import { createHash } from 'node:crypto'
import { Url } from '@rudderjs/router'
import type { MiddlewareHandler } from '@rudderjs/contracts'
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
    const user = (req as unknown as { user?: AuthUser }).user

    if (!user) {
      res.status(401).json({ message: 'Unauthorized.' })
      return
    }

    // If the user has emailVerifiedAt, they're verified
    if (user['emailVerifiedAt'] !== null && user['emailVerifiedAt'] !== undefined) {
      await next()
      return
    }

    res.status(403).json({ message: 'Your email address is not verified.' })
  }
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

  if (hash !== expected) return false

  if (!user.hasVerifiedEmail()) {
    await user.markEmailAsVerified()
  }

  return true
}

// ─── SHA-256 hash ───────────────────────────────────────────

function _sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
