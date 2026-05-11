# Guards and Route Handlers

## Reading the current user

Three equivalent ways:

```ts
import { auth, Auth, RequireAuth } from '@rudderjs/auth'

// auth() helper — Laravel-style
router.get('/api/me', async (req, res) => {
  const user = await auth().user()
  if (!user) return res.status(401).json({ message: 'Unauthorized' })
  res.json({ user })
})

// Auth facade
router.get('/api/profile', async (req, res) => {
  if (await Auth.guest()) return res.status(401).json({ message: 'Unauthorized' })
  res.json({ user: await Auth.user() })
})

// RequireAuth middleware — guarantees req.user
router.get('/api/dashboard', RequireAuth(), async (req, res) => {
  res.json({ user: req.user })
})
```

`Auth.user()` and `auth().user()` **soft-fail** outside the `AuthMiddleware` ALS context — they return `null`, never throw. This matches Laravel's `Auth::user()` semantics.

## Login / register / logout

```ts
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body
  const success = await auth().attempt({ email, password })
  if (!success) return res.status(422).json({ message: 'Invalid credentials.' })
  res.json({ user: await auth().user() })
})

router.post('/auth/register', async (req, res) => {
  const user = await User.create({
    name:     req.body.name,
    email:    req.body.email,
    password: req.body.password,   // hashed automatically via Attribute mutator
  })
  await auth().login(user)
  res.json({ user })
})

router.post('/auth/logout', RequireAuth(), async (req, res) => {
  await auth().logout()
  res.json({ message: 'Logged out.' })
})
```

`attempt({ email, password })` runs `hashCheck(plain, hashed)` internally via the `EloquentUserProvider`.

## RequireAuth vs RequireGuest

```ts
router.get('/dashboard', RequireAuth(),  handler)   // 401 if not authenticated
router.get('/login',     RequireGuest(), handler)   // redirects authenticated users away
```

## Web vs API auth

| | Web | API |
|---|---|---|
| `req.user` | ✓ — populated by `AuthMiddleware` (auto-installed on `web` group) | ✗ — stateless by default |
| Session | ✓ — `sessionMiddleware` auto-installed on `web` | ✗ — don't add it globally |
| Per-route auth | Just use `RequireAuth()` | `RequireBearer()` + `scope(...)` from `@rudderjs/passport` |

## Pitfalls

❌ **Don't** add `sessionMiddleware` to `m.use(...)` (global):

```ts
.withMiddleware((m) => {
  m.use(sessionMiddleware)   // breaks the "API is stateless" contract
})
```

✅ **Do** let `SessionProvider.boot()` install it on the `web` group only.

❌ **Don't** expect `req.user` on api routes:

```ts
router.get('/api/data', async (req, res) => {
  console.log(req.user)   // always undefined — AuthMiddleware doesn't run on api group
})
```

✅ **Do** use bearer auth per-route on api:

```ts
import { RequireBearer, scope } from '@rudderjs/passport'

router.get('/api/data', RequireBearer(), scope('read'), async (req, res) => {
  res.json({ user: req.user })
})
```

❌ **Don't** rely on `Auth.user()` outside `AuthMiddleware`:

```ts
// In a queue job — no ALS context
const user = await Auth.user()   // always null
```

✅ **Do** pass `userId` into the job and re-fetch:

```ts
class SendWelcomeEmail extends Job {
  constructor(private userId: number) { super() }
  async handle() {
    const user = await User.find(this.userId)
    // …
  }
}
```
