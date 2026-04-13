// Auth routes (Laravel Breeze-style) — imported first so its POST handlers
// register before this file's /api/* catch-all at the bottom.
import './auth.ts'

import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { resolve, dd, dump, config, validate } from '@rudderjs/core'
import { broadcast, broadcastStats } from '@rudderjs/broadcast'
import { getLocale, runWithLocale, setLocale, trans } from '@rudderjs/localization'
import { Cache } from '@rudderjs/cache'
import { Storage } from '@rudderjs/storage'
import { RateLimit, CsrfMiddleware } from '@rudderjs/middleware'
import { notify } from '@rudderjs/notification'
import { UserService } from '../app/Services/UserService.js'
import { WelcomeNotification } from '../app/Notifications/WelcomeNotification.js'
import { CreateUserRequest } from '../app/Requests/CreateUserRequest.js'
import { TestController } from '../app/Controllers/TestController.js'
import { AppError } from '../app/Exceptions/AppError.js'
import { z } from 'zod'

// Register decorator-based controllers
Route.registerController(TestController)

Route.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// Demo: Laravel-style controller views
// Visit /home and /about — controllers fetch data, view() renders pages
// from app/Views/Home.tsx and app/Views/About.tsx via Vike SSR.
Route.get('/home', async () => {
  return view('home', {
    appName:  'RudderJS',
    greeting: 'Laravel-style controller views, rendered through Vike SSR.',
    features: [
      'Routes return view() like Laravel controllers',
      'Vike handles SSR + hydration automatically',
      'Views live in app/Views/, not pages/',
      'Middleware runs before view rendering',
      'Works with React, Vue, Solid, or vanilla',
    ],
  })
})

Route.get('/about', async () => {
  return view('about', {
    title:   'About RudderJS',
    version: '0.0.1',
    team: [
      { name: 'Ada Lovelace',  role: 'Algorithms'    },
      { name: 'Alan Turing',   role: 'Computation'   },
      { name: 'Grace Hopper',  role: 'Compilers'     },
    ],
  })
})

Route.get('/api/hello', async (req) => {
  const q = req.query['lang']
  const lang = typeof q === 'string' ? q : undefined
  const locale = lang ?? getLocale()

  return runWithLocale(locale, async () => {
    if (lang) setLocale(lang)

    const message = await trans('messages.greeting', { name: 'World' })
    const items = await trans('messages.items', 3)

    return Response.json({ message, items, locale: getLocale() })
  })
})

// WebSocket demo routes
Route.post('/api/ws/broadcast', async (req, res) => {
  const { user, text, ts } = req.body as { user: string; text: string; ts: number }
  broadcast('chat', 'message', { user, text, ts })
  return res.json({ ok: true })
})

Route.get('/api/ws/ping', (_req, res) => res.json(broadcastStats()))

// GET /api/config — returns app config values via config() helper
Route.get('/api/config', (_req, res) => res.json({
  name:  config('app.name'),
  env:   config('app.env'),
  debug: config('app.debug'),
  url:   config('app.url'),
}))

// ── dd / dump demo ─────────────────────────────────────────
// GET /api/debug/dump  — prints to terminal, keeps server running
Route.get('/api/debug/dump', (req, res) => {
  dump({ note: 'Check your terminal for dump output.' })
  return res.json({ note: 'Check your terminal for dump output.' })
})

// GET /api/debug/dd  — prints to terminal then kills the server (restart required)
Route.get('/api/debug/dd', (req) => {
  dd({ note: 'This will terminate the server. Restart required.' })
})

// GET /api/debug/error  — triggers an unhandled error to test the error page
function debugThrow() {
  throw new Error('Something went wrong in a route handler.')
}
Route.get('/api/debug/error', debugThrow)

// ── Exception handling demos ──────────────────────────────
//
// These routes demonstrate global exception handling — no try/catch needed in routes.
//
// GET /api/debug/app-error?code=NOT_FOUND&status=404
//   → throws AppError → caught by e.render(AppError, ...) in bootstrap/app.ts
//   → returns { error, message } JSON with the given status code
//
// POST /api/debug/validate  body: { name, email }
//   → validate() throws ValidationError on bad input
//   → caught automatically → 422 { message, errors } — no try/catch needed
//
Route.get('/api/debug/app-error', (req) => {
  const code   = (req.query['code']   as string | undefined) ?? 'DEMO_ERROR'
  const status = Number(req.query['status'] ?? 400)
  throw new AppError(`Demo AppError with code ${code}`, status, code)
})

const debugValidateSchema = z.object({
  name:  z.string().min(2,  'Name must be at least 2 characters.'),
  email: z.string().email('Must be a valid email address.'),
})

Route.post('/api/debug/validate', async (req) => {
  // No try/catch — ValidationError is auto-converted to 422 by the global handler
  const data = await validate(debugValidateSchema, req)
  return Response.json({ valid: true, data })
})

// GET /api/me — returns current user (null if not logged in).
// No AuthMiddleware needed: the auth provider installs it globally,
// so `req.user` is populated on every request.
Route.get('/api/me', async (req) => {
  return Response.json({ user: req.user ?? null })
})

// Route.get('/id', (_req, res) => res.json({ id: res.header('X-Request-Id') }), [requestIdMiddleware])  // example of using requestIdMiddleware on a specific route

// Public routes — no auth required
// Results are cached for 60 s — subsequent calls skip the DB query
// Rate-limited to 60 req/min per IP
Route.get('/api/users', async (_req, res) => {
  const users = await Cache.remember('users:all', 60, () => {
    console.log('Cache miss for users:all — querying database...')
     return resolve<UserService>(UserService).findAll();
  })
  return res.json({ data: users })
})

Route.get('/api/users/:id', async (req, res) => {
  const user = await resolve<UserService>(UserService).findById(req.params['id']!)
  if (!user) return res.status(404).json({ message: 'User not found.' })
  return res.json({ data: user })
})

// ── File storage demo ──────────────────────────────────────
// PUT /api/files/:filename  — write a text file (10 uploads/min per IP)
Route.put('/api/files/:filename', async (req, res) => {
  const { filename } = req.params as { filename: string }
  const content = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  await Storage.put(`uploads/${filename}`, content)
  return res.json({ path: `uploads/${filename}`, url: Storage.url(`uploads/${filename}`) })
}, [RateLimit.perMinute(10)])

// GET /api/files  — list uploaded files
Route.get('/api/files', async (_req, res) => {
  const files = await Storage.list('uploads')
  return res.json({ files })
})

// GET /api/files/:filename  — read a text file (demo route, single-segment)
Route.get('/api/files/:filename', async (req, res) => {
  const { filename } = req.params as { filename: string }
  const content = await Storage.text(`uploads/${filename}`)
  if (content === null) return res.status(404).json({ message: 'File not found.' })
  return res.json({ filename, content })
})

// GET /api/files/*  — serve any stored file as binary (images, PDFs, etc.)
Route.get('/api/files/*', async (req) => {
  const filePath = req.path.slice('/api/files/'.length)
  const buffer   = await Storage.disk('local').get(filePath)
  if (!buffer) return new Response('Not Found', { status: 404 })

  const ext  = filePath.split('.').pop()?.toLowerCase() ?? ''
  const mime: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    pdf: 'application/pdf', txt: 'text/plain', json: 'application/json',
  }
  return new Response(buffer as unknown as BodyInit, {
    headers: { 'Content-Type': mime[ext] ?? 'application/octet-stream' },
  })
})

// DELETE /api/files/:filename  — delete a file
Route.delete('/api/files/:filename', async (req, res) => {
  const { filename } = req.params as { filename: string }
  await Storage.delete(`uploads/${filename}`)
  return res.json({ deleted: filename })
})

// POST /api/notify/welcome  — send a WelcomeNotification to a notifiable (mail + database)
// Body: { id, email, name? }
Route.post('/api/notify/welcome', async (req, res) => {
  const { id, email, name } = req.body as { id?: string; email?: string; name?: string }
  if (!id || !email) return res.status(422).json({ message: 'id and email are required.' })
  await notify({ id, email, ...(name !== undefined && { name }) }, new WelcomeNotification())
  return res.json({ sent: true })
})

// ── Validation demo ───────────────────────────────────────
// POST /api/validate/user  — validates body with FormRequest (returns errors on failure)
Route.post('/api/validate/user', async (req, res) => {
  const data = await new CreateUserRequest().validate(req)
  return res.json({ valid: true, data })
})

// ── Contact form demo ─────────────────────────────────────
// POST /api/contact — CSRF-protected, validates with zod
const contactSchema = z.object({
  name:    z.string().min(2,  'Name must be at least 2 characters.'),
  email:   z.string().email('Please enter a valid email address.'),
  message: z.string().min(10, 'Message must be at least 10 characters.'),
})

Route.post('/api/contact', async (req, res) => {
  const result = contactSchema.safeParse(req.body)
  if (!result.success) {
    const errors = Object.fromEntries(result.error.issues.map(i => [i.path[0], i.message]))
    return res.status(422).json({ errors })
  }
  return res.json({ ok: true, message: `Thanks ${result.data.name}, your message has been received!` })
}, [CsrfMiddleware()])

// ── AI test routes ───────────────────────────────────────────────────────────

import { AI, agent, toolDefinition, type AiMiddleware } from '@rudderjs/ai'

// Simple prompt — uses default provider
Route.get('/api/ai/prompt', async (_req, res) => {
  const response = await AI.prompt('Say hello in 3 different languages. Keep it short.')
  res.json({ text: response.text, usage: response.usage })
})

// Middleware demo — logs lifecycle events to console
Route.get('/api/ai/middleware', async (_req, res) => {
  const logs: string[] = []
  const logMw: AiMiddleware = {
    name: 'logger',
    onStart(ctx) { logs.push(`[start] model=${ctx.model}`) },
    onIteration(ctx) { logs.push(`[iteration] step=${ctx.iteration}`) },
    onBeforeToolCall(_ctx, name, args) { logs.push(`[before-tool] ${name}(${JSON.stringify(args)})`) },
    onAfterToolCall(_ctx, name, _args, result) { logs.push(`[after-tool] ${name} → ${JSON.stringify(result).slice(0, 100)}`) },
    onToolPhaseComplete() { logs.push('[tool-phase-complete]') },
    onUsage(_ctx, usage) { logs.push(`[usage] ${usage.totalTokens} tokens`) },
    onFinish() { logs.push('[finish]') },
    onError(_ctx, err) { logs.push(`[error] ${err}`) },
  }

  const weatherTool = toolDefinition({
    name: 'get_weather',
    description: 'Get the current weather for a city',
    inputSchema: z.object({ city: z.string() }),
  }).server(async ({ city }) => `The weather in ${city} is 22°C and sunny.`)

  const response = await agent({
    instructions: 'You help people check the weather. Use the get_weather tool.',
    tools: [weatherTool],
    middleware: [logMw],
  }).prompt('What is the weather in London?')

  res.json({ text: response.text, logs, usage: response.usage })
})

// Agent with instructions
Route.post('/api/ai/chat', async (req, res) => {
  const { message } = req.body as { message: string }
  const response = await AI.agent('You are a helpful assistant. Be concise.').prompt(message)
  res.json({ text: response.text, usage: response.usage })
})

// Agent with tools
Route.get('/api/ai/tools', async (_req, res) => {
  const weatherTool = toolDefinition({
    name: 'get_weather',
    description: 'Get the current weather for a city',
    inputSchema: z.object({ city: z.string() }),
  }).server(async ({ city }) => `The weather in ${city} is 22°C and sunny.`)

  const response = await agent({
    instructions: 'You help people check the weather. Use the get_weather tool when asked about weather.',
    tools: [weatherTool],
  }).prompt('What is the weather like in Tokyo and Paris?')

  res.json({
    text: response.text,
    steps: response.steps.length,
    toolCalls: response.steps.flatMap(s => s.toolCalls ?? []).map(tc => ({ name: tc.name, input: tc.input, result: tc.result })),
    usage: response.usage,
  })
})

// Streaming response
Route.post('/api/ai/stream', async (req) => {
  const { message } = (await (req.raw as any).req.json()) as { message: string }
  const { stream, response } = AI.agent('You are a helpful assistant. Be concise.').stream(message)

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk.text })}\n\n`))
        }
      }
      const final = await response
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, usage: final.usage })}\n\n`))
      controller.close()
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

// ── Passport OAuth 2 routes ──────────────────────────────
//
// Registers /oauth/authorize, /oauth/token, /oauth/tokens/:id,
// /oauth/scopes, /oauth/device/code, /oauth/device/approve.
//
// Requires: RSA keys generated via `pnpm rudder passport:keys` and
// an OAuth client created via `pnpm rudder passport:client <name>`.
import { registerPassportRoutes, RequireBearer, scope } from '@rudderjs/passport'

// Adapter: Passport expects a router with .get/.post/.delete taking (path, handler)
// but our Route uses the inverse signature. Wrap it.
const passportRouter = {
  get:    (path: string, handler: any) => Route.get(path, handler),
  post:   (path: string, handler: any) => Route.post(path, handler),
  delete: (path: string, handler: any) => Route.delete(path, handler),
}
registerPassportRoutes(passportRouter as any)

// Example: protected route requiring a Bearer token with 'read' scope
Route.get('/api/passport/me', async (req, res) => {
  return res.json({
    user: req.user ?? null,
    scopes: (req.raw as any)?.__passport_scopes ?? [],
  })
}, [RequireBearer(), scope('read')])

// Catch-all: any unmatched /api/* route returns 404 instead of falling through to Vike
Route.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))
