# Email Verification + Password Reset

## Email verification

Implement `MustVerifyEmail` on your User model:

```ts
import type { Authenticatable, MustVerifyEmail } from '@rudderjs/auth'

class User extends Model implements Authenticatable, MustVerifyEmail {
  hasVerifiedEmail()         { return this.emailVerifiedAt !== null }
  getEmailForVerification()  { return this.email }
  async markEmailAsVerified() {
    await User.update(this.id, { emailVerifiedAt: new Date() })
  }
}
```

Protect routes that require a verified email:

```ts
import { RequireAuth, EnsureEmailIsVerified } from '@rudderjs/auth'

router.get('/dashboard', RequireAuth(), EnsureEmailIsVerified(), handler)
```

Generate a signed URL to send in an email:

```ts
import { verificationUrl } from '@rudderjs/auth'

const url = verificationUrl(user)
// Sign-protected — calling it with a tampered signature returns 403
```

Handle the click:

```ts
import { handleEmailVerification } from '@rudderjs/auth'

router.get('/verify-email/:id/:hash', async (req, res) => {
  await handleEmailVerification(req.params.id, req.params.hash, (id) => User.find(id))
  res.redirect('/dashboard')
})
```

## Password reset

The `PasswordBroker` orchestrates token generation, email dispatch, and verification. A token repository persists the tokens.

```ts
import { PasswordBroker, MemoryTokenRepository } from '@rudderjs/auth'

const broker = new PasswordBroker(new MemoryTokenRepository())
```

In production, implement `TokenRepository` backed by your database:

```ts
import type { TokenRepository } from '@rudderjs/auth'

class PrismaTokenRepository implements TokenRepository {
  async create(email: string, token: string) { /* INSERT */ }
  async findByEmailAndToken(email: string, token: string) { /* SELECT */ }
  async delete(email: string) { /* DELETE */ }
  async deleteExpired(thresholdMs: number) { /* DELETE WHERE created_at < ... */ }
}
```

## Pitfalls

❌ **Don't** ship `MemoryTokenRepository` to production — tokens evaporate on restart, and multi-process / multi-worker setups never share state.

✅ **Do** persist tokens via your ORM (Prisma/Drizzle) and run a scheduled cleanup of expired rows.

❌ **Don't** assume `verificationUrl(user)` works without `APP_KEY`:

```ts
// Throws if APP_KEY isn't set
const url = verificationUrl(user)
```

✅ **Do** set `APP_KEY` in `.env` (or call `Url.setKey('test-key')` in tests).

❌ **Don't** roll a hand-crafted signature on the verification URL:

```ts
const url = `/verify-email/${user.id}/${crypto.createHash(...)}`
```

✅ **Do** use `verificationUrl(user)` — it uses HMAC-SHA256 with timing-safe comparison via `@rudderjs/router`'s `Url`.
