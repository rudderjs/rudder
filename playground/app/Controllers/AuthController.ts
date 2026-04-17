import { Controller, Post, Middleware } from '@rudderjs/router'
import { RateLimit } from '@rudderjs/middleware'
import { dispatch } from '@rudderjs/core'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import {
  Auth,
  EloquentUserProvider,
  MemoryTokenRepository,
  PasswordBroker,
} from '@rudderjs/auth'
import { Hash } from '@rudderjs/hash'
import { User } from '../Models/User.js'
import { UserRegistered } from '../Events/UserRegistered.js'

// Per-IP + per-path rate limit — each action has its own budget so sign-in attempts
// don't exhaust the sign-up or password-reset budget for the same client.
const authLimit = RateLimit.perMinute(10)
  .by(req => {
    const ip = (req as unknown as Record<string, unknown>)['ip'] as string ?? '127.0.0.1'
    return `${ip}:${req.path}`
  })
  .message('Too many auth attempts. Try again later.')

// Swap MemoryTokenRepository for PrismaTokenRepository in production
const passwordBroker = new PasswordBroker(
  new MemoryTokenRepository(),
  new EloquentUserProvider(User as any, (plain, hashed) => Hash.check(plain, hashed)),
  { expire: 60, throttle: 60 },
)

@Controller('/api/auth')
export class AuthController {
  @Post('/sign-up/email')
  @Middleware([authLimit])
  async signUp(req: AppRequest, res: AppResponse) {
    const { name, email, password } = req.body as { name: string; email: string; password: string }
    if (!name || !email || !password) return res.status(422).json({ message: 'Name, email, and password are required.' })
    if (password.length < 8)          return res.status(422).json({ message: 'Password must be at least 8 characters.' })

    const existing = await User.query().where('email', email).first()
    if (existing) return res.status(409).json({ message: 'An account with that email already exists.' })

    const hashed = await Hash.make(password)
    const user   = await User.create({ name, email, password: hashed })

    await Auth.login({
      getAuthIdentifier: () => String(user.id),
      getAuthPassword:   () => hashed,
      getRememberToken:  () => null,
      setRememberToken:  () => {},
    })

    await dispatch(new UserRegistered(user.id as string, user.name as string, user.email as string))
    return res.json({ user: { id: user.id, name: user.name, email: user.email } })
  }

  @Post('/sign-in/email')
  @Middleware([authLimit])
  async signIn(req: AppRequest, res: AppResponse) {
    const { email, password } = req.body as { email: string; password: string }
    if (!email || !password) return res.status(422).json({ message: 'Email and password are required.' })

    const success = await Auth.attempt({ email, password })
    if (!success) return res.status(401).json({ message: 'Invalid email or password.' })
    return res.json({ ok: true })
  }

  @Post('/sign-out')
  async signOut(_req: AppRequest, res: AppResponse) {
    await Auth.logout()
    return res.json({ ok: true })
  }

  @Post('/request-password-reset')
  @Middleware([authLimit])
  async requestPasswordReset(req: AppRequest, res: AppResponse) {
    const { email } = req.body as { email: string }
    if (!email) return res.status(422).json({ message: 'Email is required.' })

    await passwordBroker.sendResetLink({ email }, async (_user, token) => {
      const resetUrl = `${process.env['APP_URL'] ?? 'http://localhost:3000'}/reset-password?token=${token}&email=${email}`
      console.log(`[Auth] Password reset for ${email}: ${resetUrl}`)
    })

    // Always return success to prevent email enumeration
    return res.json({ status: 'sent' })
  }

  @Post('/reset-password')
  @Middleware([authLimit])
  async resetPassword(req: AppRequest, res: AppResponse) {
    const { token, email, newPassword } = req.body as { token: string; email?: string; newPassword: string }
    if (!token || !newPassword) return res.status(422).json({ message: 'Token and new password are required.' })

    const userEmail = email ?? ''
    if (!userEmail) return res.status(422).json({ message: 'Email is required.' })

    const status = await passwordBroker.reset(
      { email: userEmail, token, password: newPassword },
      async (user, password) => {
        const hashed = await Hash.make(password)
        await User.update(user.getAuthIdentifier(), { password: hashed } as Partial<User>)
      },
    )

    if (status === 'PASSWORD_RESET') return res.json({ ok: true })
    if (status === 'TOKEN_EXPIRED')  return res.status(400).json({ message: 'Reset token has expired.' })
    return res.status(400).json({ message: 'Invalid or expired token.' })
  }
}
