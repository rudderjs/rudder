import { Middleware } from '@rudderjs/router'
import { RateLimit } from '@rudderjs/middleware'
import {
  BaseAuthController,
  PasswordBroker,
  MemoryTokenRepository,
  EloquentUserProvider,
  type AuthUserModelLike,
} from '@rudderjs/auth'
import { Hash } from '@rudderjs/hash'
import { User } from '../../Models/User.js'

// Per-IP + per-path rate limit — each action has its own budget so sign-in
// attempts don't exhaust the sign-up or password-reset budget for the same client.
const authLimit = RateLimit.perMinute(10)
  .by(req => {
    const ip = (req as unknown as Record<string, unknown>)['ip'] as string ?? '127.0.0.1'
    return `${ip}:${req.path}`
  })
  .message('Too many auth attempts. Try again later.')

// Swap MemoryTokenRepository for a persistent one (Prisma/Redis) in production.
const broker = new PasswordBroker(
  new MemoryTokenRepository(),
  new EloquentUserProvider(User as unknown as never, (plain, hashed) => Hash.check(plain, hashed)),
  { expire: 60, throttle: 60 },
)

/**
 * Auth POST handlers — Laravel Breeze-style.
 *
 * All five endpoints (`sign-in/email`, `sign-up/email`, `sign-out`,
 * `request-password-reset`, `reset-password`) come from `BaseAuthController`.
 * The `UserRegistered` event is fired by the `UserObserver` in `app/Models/User.ts`
 * (see observer pattern — keeps the event contract tied to the model).
 */
@Middleware([authLimit])
export class AuthController extends BaseAuthController {
  protected userModel      = User as unknown as AuthUserModelLike
  protected hash           = Hash
  protected passwordBroker = broker
}
