import { Route } from '@rudderjs/router'
import { resolve, app, dd, dump, config, validate } from '@rudderjs/core'
import { broadcast, broadcastStats } from '@rudderjs/broadcast'
import { getLocale, runWithLocale, setLocale, trans } from '@rudderjs/localization'
import type { BetterAuthInstance } from '@rudderjs/auth'
import { AuthMiddleware } from '@rudderjs/auth'
import { Cache } from '@rudderjs/cache'
import { Storage } from '@rudderjs/storage'
import { RateLimit, CsrfMiddleware } from '@rudderjs/middleware'
import { notify } from '@rudderjs/notification'
import { UserService } from '../app/Services/UserService.js'
import { requestIdMiddleware } from '../app/Middleware/RequestIdMiddleware.js'
import { WelcomeNotification } from '../app/Notifications/WelcomeNotification.js'
import { CreateUserRequest } from '../app/Requests/CreateUserRequest.js'
import { TestController } from '../app/Controllers/TestController.js'
import { AppError } from '../app/Exceptions/AppError.js'
import { z } from 'zod'

// Register decorator-based controllers
Route.registerController(TestController)

// Per-route middleware instance — reused across protected routes
const authMw = AuthMiddleware()

// Auth rate limit — keyed by IP + path so each endpoint (sign-in, sign-out, sign-up)
// has its own counter per client. Prevents one action from exhausting another's budget.
const authLimit = RateLimit.perMinute(10)
  .by(req => {
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
      ?? (req.headers['x-real-ip'] as string | undefined)
      ?? 'unknown'
    return `${ip}:${req.path}`
  })
  .message('Too many auth attempts. Try again later.')

Route.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

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

// GET /api/me — returns current session (null if not logged in)
Route.get('/api/me', async (req) => {
  const auth = app().make<BetterAuthInstance>('auth')
  const session = await auth.api.getSession({
    headers: new Headers(req.headers as Record<string, string>),
  })
  return Response.json(session ?? { user: null, session: null })
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
}, [authMw])

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

import { AI, agent, toolDefinition } from '@rudderjs/ai'

// Simple prompt — uses default provider
Route.get('/api/ai/prompt', async (_req, res) => {
  const response = await AI.prompt('Say hello in 3 different languages. Keep it short.')
  res.json({ text: response.text, usage: response.usage })
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

// Auth routes — delegate all /api/auth/* requests to better-auth, with a stricter rate limit
Route.all('/api/auth/*', (req) => {
  const auth = app().make<BetterAuthInstance>('auth')
  const honoCtx = req.raw as { req: { raw: Request } }
  return auth.handler(honoCtx.req.raw)
}, [authLimit])

// ── DEBUG: Live Y.Doc tree inspector (temporary) ────────────
// GET /api/debug/live-inspect?doc=panel:articles:id:richcontent:content
import { Live } from '@rudderjs/live'
import * as Y from 'yjs'

Route.get('/api/debug/live-inspect', (req, res) => {
  const docName = req.query['doc'] as string
  if (!docName) return res.status(400).json({ error: 'Missing ?doc= parameter' })

  const fields = Live.readMap(docName, 'fields')
  const root = (() => {
    // Access room doc directly via snapshot approach
    const persistence = Live.persistence()
    const rooms = (globalThis as any)['__rudderjs_live__'] as Map<string, { doc: Y.Doc }> | undefined
    const room = rooms?.get(docName)
    if (!room) return null
    return room.doc.get('root', Y.XmlText)
  })()

  const result: Record<string, unknown> = {
    docName,
    fieldsCount: Object.keys(fields).length,
    fields,
    rootLength: root?.length ?? 0,
    tree: [] as unknown[],
  }

  if (root && root.length > 0) {
    const delta = root.toDelta() as Array<{ insert: unknown; attributes?: Record<string, unknown> }>
    const tree: unknown[] = []

    for (let i = 0; i < delta.length; i++) {
      const entry = delta[i]
      const inserted = entry.insert
      const className = inserted?.constructor?.name ?? typeof inserted

      if (typeof inserted === 'string') {
        tree.push({ index: i, type: 'text', content: inserted.slice(0, 200) })

      } else if (inserted instanceof Y.XmlText) {
        // Lexical paragraphs/headings are Y.XmlText (CollabElementNode)
        const xmlText = inserted
        const text = xmlText.toString()
        const attrs = xmlText.getAttributes()
        const node: Record<string, unknown> = {
          index: i,
          type: 'XmlText',
          attributes: attrs,
          text: text.slice(0, 300),
          length: xmlText.length,
          hasDeleteMethod: typeof xmlText.delete === 'function',
          hasInsertMethod: typeof xmlText.insert === 'function',
        }
        // Inner delta — shows text runs
        try {
          const innerDelta = xmlText.toDelta() as Array<{ insert: unknown; attributes?: Record<string, unknown> }>
          node.innerDelta = innerDelta.map((inner, j) => {
            if (typeof inner.insert === 'string') {
              return { index: j, type: 'text', content: inner.insert.slice(0, 200), attributes: inner.attributes }
            }
            const innerName = inner.insert?.constructor?.name ?? typeof inner.insert
            if (inner.insert instanceof Y.XmlElement) {
              return { index: j, type: 'XmlElement', nodeName: (inner.insert as Y.XmlElement).nodeName, attributes: (inner.insert as Y.XmlElement).getAttributes() }
            }
            if (inner.insert instanceof Y.Map) {
              const m = inner.insert as Y.Map<unknown>
              const mapData: Record<string, unknown> = {}
              m.forEach((v, k) => { mapData[k] = v })
              return { index: j, type: 'Map', data: mapData, attributes: inner.attributes }
            }
            return { index: j, type: innerName }
          })
        } catch { /* */ }
        tree.push(node)

      } else if (inserted instanceof Y.XmlElement) {
        // Lexical blocks/decorators are Y.XmlElement (CollabDecoratorNode)
        const elem = inserted
        const attrs = elem.getAttributes()
        tree.push({
          index: i,
          type: 'XmlElement',
          nodeName: elem.nodeName,
          attributes: attrs,
          text: elem.toString().slice(0, 200),
          childCount: elem.length,
        })

      } else {
        tree.push({ index: i, type: className })
      }
    }
    result.tree = tree
  }

  return res.json(result)
})

// ── DEBUG: Test Live.editText / editBlock (temporary) ───────
Route.post('/api/debug/live-edit-text', async (req, res) => {
  const { doc, operation } = req.body as { doc: string; operation: { type: string; search: string; replace?: string; text?: string } }
  if (!doc || !operation) return res.status(400).json({ error: 'Missing doc or operation' })
  const result = Live.editText(doc, operation as any, { name: 'AI: Test Agent', color: '#8b5cf6' })
  // Clear cursor after 3 seconds
  setTimeout(() => Live.clearAiAwareness(doc), 3000)
  return res.json({ applied: result })
})

Route.post('/api/debug/live-edit-block', async (req, res) => {
  const { doc, blockType, blockIndex, field, value } = req.body as { doc: string; blockType: string; blockIndex: number; field: string; value: unknown }
  if (!doc || !blockType) return res.status(400).json({ error: 'Missing params' })
  const result = Live.editBlock(doc, blockType, blockIndex ?? 0, field, value)
  return res.json({ applied: result })
})

Route.post('/api/debug/live-awareness', async (req, res) => {
  const { doc, action, search } = req.body as { doc: string; action: 'set' | 'clear'; search?: string }
  if (!doc) return res.status(400).json({ error: 'Missing doc' })
  if (action === 'clear') {
    Live.clearAiAwareness(doc)
    return res.json({ ok: true })
  }
  // If search is provided, place cursor at that text location
  if (search) {
    const rooms = (globalThis as any)['__rudderjs_live__'] as Map<string, { doc: Y.Doc }> | undefined
    const room = rooms?.get(doc)
    if (room) {
      const root = room.doc.get('root', Y.XmlText)
      const { findTextInXmlTree } = await import('@rudderjs/live') as any
      // Use the internal helper — or just inline the logic
      const delta = root.toDelta() as Array<{ insert: unknown }>
      let cursorTarget: { target: Y.XmlText; offset: number } | undefined
      for (const entry of delta) {
        if (!(entry.insert instanceof Y.XmlText)) continue
        const child = entry.insert as Y.XmlText
        const innerDelta = child.toDelta() as Array<{ insert: unknown }>
        let offset = 0
        for (const item of innerDelta) {
          if (typeof item.insert === 'string') {
            const idx = (item.insert as string).indexOf(search)
            if (idx !== -1) { cursorTarget = { target: child, offset: offset + idx }; break }
            offset += (item.insert as string).length
          } else { offset += 1 }
        }
        if (cursorTarget) break
      }
      if (cursorTarget) {
        Live.setAiAwareness(doc, { name: 'AI: Test Agent', color: '#8b5cf6' }, cursorTarget)
        return res.json({ ok: true, cursorAt: search })
      }
    }
  }
  Live.setAiAwareness(doc, { name: 'AI: Test Agent', color: '#8b5cf6' })
  return res.json({ ok: true })
})

// Catch-all: any unmatched /api/* route returns 404 instead of falling through to Vike
Route.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))
