import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { resolve, dd, dump, config, validate } from '@rudderjs/core'
import { broadcast, broadcastStats } from '@rudderjs/broadcast'
import { getLocale, runWithLocale, setLocale, trans } from '@rudderjs/localization'
import { Cache } from '@rudderjs/cache'
import { Storage } from '@rudderjs/storage'
import { RateLimit, CsrfMiddleware } from '@rudderjs/middleware'
import { notify } from '@rudderjs/notification'
import { UserService } from 'App/Services/UserService.js'
import { WelcomeNotification } from 'App/Notifications/WelcomeNotification.js'
import { CreateUserRequest } from 'App/Http/Requests/CreateUserRequest.js'
import { TestController } from 'App/Http/Controllers/TestController.js'
import { AppError } from 'App/Exceptions/AppError.js'
import { Model } from '@rudderjs/orm'
import { Post } from 'App/Models/Post.js'
import { Video } from 'App/Models/Video.js'
import { Comment } from 'App/Models/Comment.js'
import { Tag } from 'App/Models/Tag.js'
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

// GET /api/fib?n=36&count=4 — compute fib(n) `count` times, sequentially then in parallel via @rudderjs/concurrency.
Route.get('/api/fib', async (req, res) => {
  const n     = Math.max(1, Math.min(42, Number((req.query as Record<string, string>)['n'] ?? 36)))
  const count = Math.max(1, Math.min(16, Number((req.query as Record<string, string>)['count'] ?? 4)))

  const { Concurrency } = await import('@rudderjs/concurrency')
  const { cpus }        = await import('node:os')

  // The task body must be self-contained — closures don't capture variables across the
  // worker boundary. Inline `fib` and bind `n` via a Function-style template.
  const buildTask = (val: number): (() => number) => {
    const src = `
      function fib(k) { return k < 2 ? k : fib(k - 1) + fib(k - 2) }
      return fib(${val})
    `
    return new Function(src) as () => number
  }

  // Sequential: run each in turn (blocks the event loop while running).
  const seqStart = Date.now()
  let result = 0
  for (let i = 0; i < count; i++) result = buildTask(n)()
  const sequentialMs = Date.now() - seqStart

  // Parallel: dispatch to worker pool — each task runs in its own worker thread.
  const parStart = Date.now()
  const tasks = Array.from({ length: count }, () => buildTask(n))
  const results = await Concurrency.run(tasks)
  const parallelMs = Date.now() - parStart
  result = results[0] ?? result

  return res.json({
    n,
    count,
    result,
    sequentialMs,
    parallelMs,
    workers: Math.min(count, cpus().length),
  })
})

// GET /api/system-info — runs three shell commands and reports parallel vs sequential timing.
// Demonstrates @rudderjs/process: Process.run() (single command) and Process.pool() (parallel).
Route.get('/api/system-info', async (_req, res) => {
  const { Process } = await import('@rudderjs/process')
  const commands = ['git rev-parse HEAD', 'node --version', 'uptime']

  // Sequential: await each command in turn — sum of individual durations.
  const sequential: { command: string; duration: number }[] = []
  for (const cmd of commands) {
    const t0 = Date.now()
    await Process.run(cmd)
    sequential.push({ command: cmd, duration: Date.now() - t0 })
  }
  const totalMs = sequential.reduce((sum, r) => sum + r.duration, 0)

  // Parallel: Process.pool() fires all at once.
  const t0   = Date.now()
  const pool = await Process.pool(commands)
  const parallelMs = Date.now() - t0

  const results = pool.results.map((r, i) => ({
    command:  commands[i],
    ok:       r.successful(),
    exitCode: r.exitCode,
    duration: sequential[i]!.duration,
    stdout:   r.stdout.trim(),
    stderr:   r.stderr.trim(),
  }))

  return res.json({ results, totalMs, parallelMs })
})

// ── Demo API endpoints (paired with /demos/* views) ───────────────────────

// POST /api/cache/views — read+increment+write (no TTL); DELETE to forget the key.
Route.post('/api/cache/views', async (_req, res) => {
  const KEY     = 'demos:views'
  const current = (await Cache.get<number>(KEY)) ?? 0
  const next    = current + 1
  await Cache.set(KEY, next)
  res.json({ views: next, key: KEY })
})

Route.delete('/api/cache/views', async (_req, res) => {
  await Cache.forget('demos:views')
  res.json({ views: 0, key: 'demos:views' })
})

// ── /demos/polymorphic — morphMany / morphTo via @rudderjs/orm ──────────────

// GET /api/polymorphic/state — posts + videos with their comments + tags
// hydrated, plus the flat tag list.
Route.get('/api/polymorphic/state', async (_req, res) => {
  const [posts, videos, tags] = await Promise.all([Post.all(), Video.all(), Tag.all()])
  const hydrate = async (parent: Post | Video) => {
    const r = parent as unknown as { related(n: string): { get(): Promise<unknown[]> } }
    const [comments, ptags] = await Promise.all([
      r.related('comments').get() as Promise<Comment[]>,
      r.related('tags').get()     as Promise<Tag[]>,
    ])
    return {
      ...parent,
      comments: comments.map(c => ({ ...c })),
      tags:     ptags.map(t => ({ ...t })),
    }
  }
  res.json({
    posts:  await Promise.all(posts.map(hydrate)),
    videos: await Promise.all(videos.map(hydrate)),
    tags:   tags.map(t => ({ ...t })),
  })
})

// POST /api/polymorphic/posts — create a post.
Route.post('/api/polymorphic/posts', async (req, res) => {
  const { title } = (req.body ?? {}) as { title?: string }
  if (!title) return res.status(400).json({ error: 'title required' })
  const post = await Post.create({ title })
  res.status(201).json({ ...post })
})

// POST /api/polymorphic/videos — create a video.
Route.post('/api/polymorphic/videos', async (req, res) => {
  const { url } = (req.body ?? {}) as { url?: string }
  if (!url) return res.status(400).json({ error: 'url required' })
  const video = await Video.create({ url })
  res.status(201).json({ ...video })
})

// POST /api/polymorphic/(posts|videos)/:id/comments — write via Model.morph().
// Demonstrates the symmetric write helper: spread the result into create()
// and the commentableId/commentableType columns get populated together.
Route.post('/api/polymorphic/posts/:id/comments', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const post = await Post.find(Number(idParam))
  if (!post) return res.status(404).json({ error: 'post not found' })
  const { body } = (req.body ?? {}) as { body?: string }
  if (!body) return res.status(400).json({ error: 'body required' })
  const comment = await Comment.create({ body, ...Model.morph('commentable', post) })
  res.status(201).json({ ...comment })
})

Route.post('/api/polymorphic/videos/:id/comments', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const video = await Video.find(Number(idParam))
  if (!video) return res.status(404).json({ error: 'video not found' })
  const { body } = (req.body ?? {}) as { body?: string }
  if (!body) return res.status(400).json({ error: 'body required' })
  const comment = await Comment.create({ body, ...Model.morph('commentable', video) })
  res.status(201).json({ ...comment })
})

// GET /api/polymorphic/comments/:id/parent — morphTo resolution.
// Reads commentableType, branches via the closed types: () => [Post, Video]
// list, and runs Target.where(pk, commentableId).first() under the hood.
Route.get('/api/polymorphic/comments/:id/parent', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const comment = await Comment.find(Number(idParam))
  if (!comment) return res.status(404).json({ error: 'comment not found' })

  const parent = await (comment as unknown as { related(n: string): { first(): Promise<Post | Video | null> } })
    .related('commentable').first()
  if (!parent) return res.status(404).json({ error: 'parent not found' })

  res.json({
    type:  comment.commentableType,
    id:    parent.id,
    title: 'title' in parent ? parent.title : parent.url,
  })
})

// ── /demos/polymorphic — morphToMany / morphedByMany tag endpoints ─────────

// POST /api/polymorphic/tags — create a tag.
Route.post('/api/polymorphic/tags', async (req, res) => {
  const { name } = (req.body ?? {}) as { name?: string }
  if (!name) return res.status(400).json({ error: 'name required' })
  const tag = await Tag.create({ name })
  res.status(201).json({ ...tag })
})

// POST /api/polymorphic/posts/:id/tags — attach a tag to a post via
// morphToMany. The pivot row carries taggableType='Post' automatically.
Route.post('/api/polymorphic/posts/:id/tags', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const post = await Post.find(Number(idParam))
  if (!post) return res.status(404).json({ error: 'post not found' })
  const { tagId } = (req.body ?? {}) as { tagId?: number }
  if (typeof tagId !== 'number') return res.status(400).json({ error: 'tagId required' })
  await Model.morphToMany(post, 'tags').attach([tagId])
  res.json({ ok: true })
})

// POST /api/polymorphic/videos/:id/tags — attach a tag to a video.
Route.post('/api/polymorphic/videos/:id/tags', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const video = await Video.find(Number(idParam))
  if (!video) return res.status(404).json({ error: 'video not found' })
  const { tagId } = (req.body ?? {}) as { tagId?: number }
  if (typeof tagId !== 'number') return res.status(400).json({ error: 'tagId required' })
  await Model.morphToMany(video, 'tags').attach([tagId])
  res.json({ ok: true })
})

// DELETE /api/polymorphic/posts/:id/tags/:tagId — detach a tag (scoped to
// taggableType='Post' so videos sharing the same tag are untouched).
Route.delete('/api/polymorphic/posts/:id/tags/:tagId', async (req, res) => {
  const id = req.params['id']; const tagId = req.params['tagId']
  if (!id || !tagId) return res.status(400).json({ error: 'id/tagId required' })
  const post = await Post.find(Number(id))
  if (!post) return res.status(404).json({ error: 'post not found' })
  await Model.morphToMany(post, 'tags').detach([Number(tagId)])
  res.json({ ok: true })
})

Route.delete('/api/polymorphic/videos/:id/tags/:tagId', async (req, res) => {
  const id = req.params['id']; const tagId = req.params['tagId']
  if (!id || !tagId) return res.status(400).json({ error: 'id/tagId required' })
  const video = await Video.find(Number(id))
  if (!video) return res.status(404).json({ error: 'video not found' })
  await Model.morphToMany(video, 'tags').detach([Number(tagId)])
  res.json({ ok: true })
})

// GET /api/polymorphic/tags/:id/items — inverse fan-out via morphedByMany.
// One pivot table; two scoped reads (one per concrete inverse class).
Route.get('/api/polymorphic/tags/:id/items', async (req, res) => {
  const idParam = req.params['id']
  if (!idParam) return res.status(400).json({ error: 'id required' })
  const tag = await Tag.find(Number(idParam))
  if (!tag) return res.status(404).json({ error: 'tag not found' })
  const r = tag as unknown as { related(n: string): { get(): Promise<unknown[]> } }
  const [posts, videos] = await Promise.all([
    r.related('posts').get()  as Promise<Post[]>,
    r.related('videos').get() as Promise<Video[]>,
  ])
  res.json({
    posts:  posts.map(p  => ({ ...p })),
    videos: videos.map(v => ({ ...v })),
  })
})

// POST /api/queue/dispatch — enqueue ExampleJob. Worker drains it during dev.
Route.post('/api/queue/dispatch', async (_req, res) => {
  const { ExampleJob } = await import('App/Jobs/ExampleJob.js')
  await ExampleJob.dispatch('hello from /api/queue/dispatch').send()
  res.json({ ok: true, queue: 'default', dispatchedAt: new Date().toISOString() })
})

// POST /api/mail/send — sends a DemoMail to the user-supplied address.
Route.post('/api/mail/send', async (req, res) => {
  const body = (req.body ?? {}) as { to?: string; subject?: string }
  if (!body.to || !body.subject) {
    return res.status(422).json({ message: 'Body must be { to, subject }' })
  }
  const { Mail }     = await import('@rudderjs/mail')
  const { DemoMail } = await import('App/Mail/DemoMail.js')
  await Mail.to(body.to).send(new DemoMail(body.subject))
  return res.json({
    ok:      true,
    to:      body.to,
    subject: body.subject,
    driver:  config<string>('mail.default', 'log'),
  })
})

// POST /api/notifications/send — dispatches WelcomeNotification to the supplied email.
// Synthesizes a notifiable so both mail + database channels can fire.
Route.post('/api/notifications/send', async (req, res) => {
  const body = (req.body ?? {}) as { to?: string }
  if (!body.to) return res.status(422).json({ message: 'Body must be { to }' })

  const notification = new WelcomeNotification()
  await notify({ id: `demo-${Date.now()}`, email: body.to, name: 'Demo User' }, notification)
  return res.json({
    ok:       true,
    to:       body.to,
    channels: notification.via({ id: '0', email: body.to }),
  })
})

// GET /api/i18n?locale=… — resolves the same keys in the requested locale.
Route.get('/api/i18n', async (req, res) => {
  const requested = (req.query as Record<string, string>)['locale'] ?? 'en'

  const payload = await runWithLocale(requested, async () => {
    setLocale(requested)
    return {
      locale:   getLocale(),
      welcome:  await trans('messages.welcome'),
      greeting: await trans('messages.greeting', { name: 'World' }),
      items:    await trans('messages.items', 3),
    }
  })

  return res.json(payload)
})

// GET /api/http/fetch?url=… — server-side HTTP with retry + timeout.
Route.get('/api/http/fetch', async (req, res) => {
  const url = (req.query as Record<string, string>)['url']
  if (!url) return res.status(422).json({ message: 'url is required' })
  if (!/^https?:\/\//.test(url)) return res.status(422).json({ message: 'url must be http(s)' })

  const { Http } = await import('@rudderjs/http')
  const t0 = Date.now()
  try {
    const response = await Http.retry(3, 200).timeout(5000).get(url)
    let body: unknown = null
    try { body = response.json() } catch { body = response.body.slice(0, 600) }
    return res.json({
      status:     response.status,
      ok:         response.ok(),
      durationMs: Date.now() - t0,
      url,
      body,
    })
  } catch (e) {
    return res.status(502).json({ message: (e as Error).message ?? 'Request failed', durationMs: Date.now() - t0, url })
  }
})

// POST /api/avatar — resize an uploaded image to 256x256 webp via @rudderjs/image
Route.post('/api/avatar', async (req, res) => {
  const { image: dataUrl } = (req.body ?? {}) as { image?: string }
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return res.status(422).json({ message: 'Body must be { image: "data:image/...;base64,..." }' })
  }
  const base64 = dataUrl.split(',', 2)[1] ?? ''
  const input  = Buffer.from(base64, 'base64')

  const { image } = await import('@rudderjs/image')

  const original = await image(input).metadata()
  const buf      = await image(input).resize(256, 256).format('webp').quality(85).toBuffer()
  const meta     = await image(buf).metadata()

  const filename = `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`
  await Storage.disk('public').put(filename, buf)

  return res.json({
    original: {
      format: original.format,
      width:  original.width,
      height: original.height,
      size:   input.length,
    },
    processed: {
      url:    Storage.disk('public').url(filename),
      format: meta.format,
      width:  meta.width,
      height: meta.height,
      size:   buf.length,
    },
  })
}, [RateLimit.perMinute(10)])

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
    toolCalls: response.steps.flatMap(s => s.toolCalls.map(tc => ({
      name:   tc.name,
      input:  tc.arguments,
      result: s.toolResults.find(r => r.toolCallId === tc.id)?.result,
    }))),
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

// ── Computer-use browser agent (#A7) ─────────────────────
//
// POST /api/browser/run  body: { url: string, query: string }
// → { ok, text, steps[], usage } | { ok: false, error, errorHint? }
//
// Launches headless Chromium, navigates to `url`, hands the Page to a
// BrowserAgent (Anthropic Claude + computerUseTool), runs the agent
// against `query`, returns the final answer + step list.
//
// Requirements: ANTHROPIC_API_KEY in env + `npx playwright install
// chromium` once. Both checked at runtime with friendly errors.
Route.post('/api/browser/run', async (req, res) => {
  const { url, query } = (req.body ?? {}) as { url?: string; query?: string }
  if (!url || !query) {
    return res.status(422).json({
      ok: false,
      error: 'url and query are required.',
    })
  }
  if (!process.env['ANTHROPIC_API_KEY']) {
    return res.status(500).json({
      ok: false,
      error: 'ANTHROPIC_API_KEY is not set.',
      errorHint: 'Add ANTHROPIC_API_KEY=sk-ant-... to playground/.env and restart `pnpm dev`.',
    })
  }

  // Lazy-load Playwright server-side only — Vite externalizes it; no
  // browser bundle impact.
  let browser: { close(): Promise<void> } | null = null
  try {
    const { chromium } = await import('playwright')
    browser = await chromium.launch()
    const page = await (browser as unknown as { newPage(): Promise<unknown> }).newPage() as {
      setViewportSize(s: { width: number; height: number }): Promise<void>
      goto(u: string, o?: { timeout?: number }): Promise<unknown>
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(url, { timeout: 15_000 })

    const { BrowserAgent } = await import('App/Agents/BrowserAgent.js')
    const agent = new BrowserAgent(page as never)
    const response = await agent.prompt(query)

    const steps = (response.steps ?? []).flatMap((step) =>
      (step.toolCalls ?? []).map((call, i) => {
        const args = (call.arguments ?? {}) as Record<string, unknown>
        const result = step.toolResults?.[i]?.result
        const resultStr = result === undefined
          ? '(no result)'
          : typeof result === 'string'
            ? result
            : Array.isArray(result) && (result[0] as { type?: string })?.type === 'image'
              ? '[image]'
              : JSON.stringify(result).slice(0, 200)
        const action = String(args['action'] ?? call.name)
        const detail = args['coordinate'] ? ` ${JSON.stringify(args['coordinate'])}` : args['text'] ? ` ${JSON.stringify(args['text'])}` : ''
        // Heuristic: result strings that contain "error" or look like an
        // Error.message — flag for the UI. Not a hard contract.
        const isError = typeof result === 'string' && /^(error|boom|exception)/i.test(result)
        return {
          action: `${action}${detail}`,
          result: resultStr,
          isError,
        }
      }),
    )

    return res.json({
      ok:    true,
      text:  response.text,
      steps,
      usage: {
        inputTokens:  response.usage.promptTokens,
        outputTokens: response.usage.completionTokens,
        totalTokens:  response.usage.totalTokens,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Friendly hint for the most common first-time setup miss.
    if (/Executable doesn't exist|Failed to launch chromium|browserType\.launch/i.test(msg)) {
      return res.status(500).json({
        ok: false,
        error: msg,
        errorHint: 'Run `npx playwright install chromium` from playground/, then retry.',
      })
    }
    return res.status(500).json({ ok: false, error: msg })
  } finally {
    if (browser) await browser.close().catch(() => undefined)
  }
}, [RateLimit.perMinute(5)])

// ── Passport OAuth 2 routes ──────────────────────────────
//
// Registers the **api half** of Passport — POST /oauth/token,
// POST /oauth/device/code, POST /oauth/device/approve, GET /oauth/scopes.
// The **web half** (consent + revoke endpoints) is mounted in routes/web.ts
// via registerPassportWebRoutes(), because the consent flow depends on
// session + authenticated user resolution.
//
// Requires: RSA keys generated via `pnpm rudder passport:keys` and
// an OAuth client created via `pnpm rudder passport:client <name>`.
import { registerPassportApiRoutes, RequireBearer, scope } from '@rudderjs/passport'

// Adapter: Passport expects a router with .get/.post/.delete taking (path, handler)
// but our Route uses the inverse signature. Wrap it.
const passportRouter = {
  get:    (path: string, handler: any) => Route.get(path, handler),
  post:   (path: string, handler: any) => Route.post(path, handler),
  delete: (path: string, handler: any) => Route.delete(path, handler),
}
registerPassportApiRoutes(passportRouter as any, {
  // Per-route rate limit on the brute-force surface — keyed by ip+client_id
  // so one noisy client doesn't exhaust the budget for legitimate co-tenants
  // behind a shared NAT, AND a single IP can't churn through the registry.
  // Requires a cache provider (see config/cache.ts).
  tokenMiddleware: [
    RateLimit.perMinute(10).by((req) => `${(req as any).ip}:${(req.body as any)?.client_id}`),
  ],
})

// Example: protected route requiring a Bearer token with 'read' scope
Route.get('/api/passport/me', async (req, res) => {
  return res.json({
    user: req.user ?? null,
    scopes: (req.raw as any)?.__passport_scopes ?? [],
  })
}, [RequireBearer(), scope('read')])

// ── Personal access tokens (HasApiTokens on User) ────────
// POST /api/tokens  body: { name, scopes? } — create a personal access token
// GET  /api/tokens                           — list current user's tokens
// DELETE /api/tokens                         — revoke all of the user's tokens
import { RequireAuth } from '@rudderjs/auth'
import { User } from 'App/Models/User.js'

Route.post('/api/tokens', async (req, res) => {
  const { name, scopes } = req.body as { name?: string; scopes?: string[] }
  if (!name) return res.status(422).json({ message: 'name is required.' })
  const user = await User.find((req.user as { id: string }).id) as User | null
  if (!user) return res.status(404).json({ message: 'User not found.' })
  const { token, plainTextToken } = await user.createToken(name, scopes ?? ['*'])
  return res.status(201).json({ id: (token as any).id, plainTextToken })
}, [RequireAuth()])

Route.get('/api/tokens', async (req, res) => {
  const user = await User.find((req.user as { id: string }).id) as User | null
  if (!user) return res.status(404).json({ message: 'User not found.' })
  const tokens = await user.tokens()
  return res.json({ tokens: tokens.map(t => ({ id: (t as any).id, name: (t as any).name, revoked: t.revoked, expiresAt: t.expiresAt })) })
}, [RequireAuth()])

Route.delete('/api/tokens', async (req, res) => {
  const user = await User.find((req.user as { id: string }).id) as User | null
  if (!user) return res.status(404).json({ message: 'User not found.' })
  const revoked = await user.revokeAllTokens()
  return res.json({ revoked })
}, [RequireAuth()])

// Catch-all: any unmatched /api/* route returns 404 instead of falling through to Vike
Route.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))
