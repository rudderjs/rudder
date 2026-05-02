export function authController(): string {
  return `import { Middleware } from '@rudderjs/router'
import { RateLimit } from '@rudderjs/middleware'
import {
  BaseAuthController,
  PasswordBroker,
  MemoryTokenRepository,
  EloquentUserProvider,
  type AuthUserModelLike,
} from '@rudderjs/auth'
import { Hash } from '@rudderjs/hash'
import { User } from '../../Models/User.ts'

// Per-IP + per-path rate limit — sign-in attempts don't exhaust the sign-up
// or password-reset budget for the same client.
const authLimit = RateLimit.perMinute(10)
  .by(req => {
    const ip = (req as unknown as Record<string, unknown>)['ip'] as string ?? '127.0.0.1'
    return \`\${ip}:\${req.path}\`
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
 * Extends \`BaseAuthController\` from @rudderjs/auth which provides the five
 * standard endpoints (\`sign-in/email\`, \`sign-up/email\`, \`sign-out\`,
 * \`request-password-reset\`, \`reset-password\`). Override any method to
 * customize behavior — the base uses \`this.userModel\` / \`this.hash\` /
 * \`this.passwordBroker\` for its defaults, so replacing those fields is
 * usually all you need.
 *
 * Registered from \`routes/web.ts\` via \`Route.registerController(AuthController)\`
 * so the handlers inherit SessionMiddleware + AuthMiddleware from the web group.
 */
@Middleware([authLimit])
export class AuthController extends BaseAuthController {
  protected userModel      = User as unknown as AuthUserModelLike
  protected hash           = Hash
  protected passwordBroker = broker
}
`
}
