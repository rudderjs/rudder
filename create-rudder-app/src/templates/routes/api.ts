import { shouldScaffoldDemos, type TemplateContext } from '../../templates.js'

export function routesApi(ctx: TemplateContext): string {
  const imports: string[] = [
    "import { router } from '@rudderjs/router'",
  ]
  const lines: string[] = []

  if (ctx.packages.auth || ctx.packages.ai) {
    imports.push("import { app } from '@rudderjs/core'")
  }
  if (ctx.packages.auth) {
    imports.push("import { Auth, AuthManager, runWithAuth } from '@rudderjs/auth'")
    imports.push("import { SessionMiddleware } from '@rudderjs/session'")
  }
  if (ctx.packages.ai) {
    imports.push("import { AI } from '@rudderjs/ai'")
  }

  lines.push('')
  lines.push("router.get('/api/health', (_req, res) => res.json({ status: 'ok' }))")

  if (ctx.packages.auth) {
    lines.push('')
    lines.push(`// GET /api/me — returns current user or null (Laravel Sanctum SPA-style).
// Api routes are stateless by default, so session is opted in per-route.
// Session-mutating handlers (sign-in, sign-up, sign-out, password reset)
// live in routes/web.ts so they inherit SessionMiddleware from the web group.
router.get('/api/me', async (req, res) => {
  const manager = app().make<AuthManager>('auth.manager')
  let user: Record<string, unknown> | null = null
  await runWithAuth(manager, async () => {
    const authUser = await Auth.user()
    if (authUser) {
      user = { id: authUser.getAuthIdentifier() }
    }
  })
  res.json({ user })
}, [SessionMiddleware()])`)
  }

  if (ctx.packages.ai) {
    lines.push('')
    lines.push(`// POST /api/ai/chat — simple AI chat endpoint
router.post('/api/ai/chat', async (req, res) => {
  const { messages } = req.body as { messages: { role: string; content: string }[] }
  const lastMessage  = messages.at(-1)?.content ?? ''
  const response     = await AI.agent('You are a helpful assistant.').prompt(lastMessage)
  res.json({ message: response.text })
})`)
  }

  if (ctx.packages.passport) {
    imports.push("import { registerPassportRoutes, RequireBearer, scope } from '@rudderjs/passport'")
    lines.push('')
    lines.push(`// ── Passport OAuth 2 routes ──────────────────────────────
//
// Registers /oauth/authorize, /oauth/token, /oauth/tokens/:id,
// /oauth/scopes, /oauth/device/code, /oauth/device/approve.
//
// Requires: RSA keys via \`pnpm rudder passport:keys\` and an OAuth client
// via \`pnpm rudder passport:client <name>\`.
const passportRouter = {
  get:    (path: string, handler: any) => router.get(path, handler),
  post:   (path: string, handler: any) => router.post(path, handler),
  delete: (path: string, handler: any) => router.delete(path, handler),
}
registerPassportRoutes(passportRouter as any)

// Example: protected route requiring a Bearer token with 'read' scope
router.get('/api/passport/me', async (req, res) => {
  res.json({
    user:   req.user ?? null,
    scopes: (req.raw as any)?.__passport_scopes ?? [],
  })
}, [RequireBearer(), scope('read')])`)
  }

  if (shouldScaffoldDemos(ctx)) {
    imports.push(`import { z } from '@rudderjs/core'`)
    if (ctx.packages.auth) imports.push(`import { CsrfMiddleware } from '@rudderjs/middleware'`)
    if (ctx.packages.broadcast) imports.push(`import { broadcast, broadcastStats } from '@rudderjs/broadcast'`)

    lines.push('')
    lines.push(`// ── Demos ────────────────────────────────────────────────
// POST /api/contact — Zod validation${ctx.packages.auth ? ' + CSRF' : ''}.
const contactSchema = z.object({
  name:    z.string().min(2,  'Name must be at least 2 characters.'),
  email:   z.string().email('Please enter a valid email address.'),
  message: z.string().min(10, 'Message must be at least 10 characters.'),
})

router.post('/api/contact', async (req, res) => {
  const result = contactSchema.safeParse(req.body)
  if (!result.success) {
    const errors = Object.fromEntries(result.error.issues.map(i => [i.path[0], i.message]))
    return res.status(422).json({ errors })
  }
  return res.json({ ok: true, message: \`Thanks \${result.data.name}, your message has been received!\` })
}${ctx.packages.auth ? ', [CsrfMiddleware()]' : ''})`)

    if (ctx.packages.broadcast) {
      lines.push('')
      lines.push(`// POST /api/ws/broadcast — push a chat message to subscribers of the 'chat' channel.
router.post('/api/ws/broadcast', async (req, res) => {
  const { user, text } = req.body as { user: string; text: string }
  broadcast('chat', 'message', { user, text, ts: Date.now() })
  res.json({ ok: true })
})

// GET /api/ws/ping — current connection / channel counts.
router.get('/api/ws/ping', (_req, res) => res.json(broadcastStats()))`)
    }
  }

  lines.push('')
  lines.push("// Catch-all: any unmatched /api/* route returns 404")
  lines.push("router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))")

  return imports.join('\n') + '\n' + lines.join('\n') + '\n'
}
