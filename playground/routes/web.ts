import { createRequire } from 'node:module'
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { config, resolve } from '@rudderjs/core'
import { auth } from '@rudderjs/auth'
import { registerAuthRoutes } from '@rudderjs/auth/routes'
import { registerPassportWebRoutes } from '@rudderjs/passport'
import { registerCashierRoutes, Cashier } from '@rudderjs/cashier-paddle'
import { Feature, FeatureMiddleware } from '@rudderjs/pennant'
import { AuthController } from '../app/Http/Controllers/AuthController.js'
import { BillingController, billingDemoProps, billingSubscriptionsProps } from '../app/Http/Controllers/BillingController.js'
import { TodoService } from '../app/Modules/Todo/TodoService.js'
import { User } from '../app/Models/User.js'
import { Post } from '../app/Models/Post.js'
import { Video } from '../app/Models/Video.js'
import { Tag } from '../app/Models/Tag.js'
import type { Comment } from '../app/Models/Comment.js'


// GET view pages — /login, /register, /forgot-password, /reset-password
registerAuthRoutes(Route)

// POST handlers — sign-in/email, sign-up/email, sign-out, password reset.
Route.registerController(AuthController)

// Passport's stateful endpoints — GET/POST/DELETE /oauth/authorize and
// DELETE /oauth/tokens/:id. Belongs on `web` because the consent flow
// needs the resolved authenticated user (web group runs AuthMiddleware
// + session).
//
// CSRF protection comes from `m.web(CsrfMiddleware(...))` in
// bootstrap/app.ts — every web-group route is already protected. Apps
// that DON'T mount CSRF at the group level can opt in per-route via
// `authorizeMiddleware: [CsrfMiddleware()]`.
//
// The stateless half (POST /oauth/token, /oauth/device/*, /oauth/scopes)
// is mounted in routes/api.ts via registerPassportApiRoutes().
registerPassportWebRoutes(Route)

// Paddle webhook receiver — POST /paddle/webhook (standalone, no web/api group).
registerCashierRoutes(Route)

// Billing demo controller — POST /api/billing/checkout, GET/POST /api/billing/subscriptions/*.
Route.registerController(BillingController)

// Cashier needs to know which Model represents the billable for webhook
// dispatch — set it once at boot via the User class.
Cashier.useBillableModel(User)

// Read RudderJS version from @rudderjs/core's package.json at boot time.
const _require = createRequire(import.meta.url)
const rudderCorePkg = _require('@rudderjs/core/package.json') as { version: string }

// Welcome page — replaces the pages/index/ Vike page with a controller view.
// Delete this route and app/Views/Welcome.tsx to swap in your own landing page.
Route.get('/', async () => {
  const current = await auth().user() as Record<string, unknown> | null
  const user = current
    ? { name: String(current['name'] ?? ''), email: String(current['email'] ?? '') }
    : null

  return view('welcome', {
    appName:       config<string>('app.name', 'RudderJS'),
    rudderVersion: rudderCorePkg.version,
    nodeVersion:   process.version.replace(/^v/, ''),
    env:           config<string>('app.env', 'development'),
    user,
  })
})

// Web routes — HTML redirects, guards, and non-API server responses
// These run before Vike's file-based page routing
// Use this file for: redirects, server-side auth guards, download routes, sitemaps, etc.

Route.get('/test-get-route', (_req, res) => {
  res.send('test response')
})

// GET /demos — index page listing all available demos.
Route.get('/demos', async () => view('demos.index'))

// GET /demos/contact — CSRF + Zod validation demo.
// POST handler for /api/contact lives in routes/api.ts.
Route.get('/demos/contact', async () => view('demos.contact'))

// GET /demos/avatar — image resize demo via @rudderjs/image + @rudderjs/storage.
// POST handler for /api/avatar lives in routes/api.ts.
Route.get('/demos/avatar', async () => view('demos.avatar'))

// GET /demos/system-info — shell exec demo via @rudderjs/process.
// GET handler for /api/system-info lives in routes/api.ts.
Route.get('/demos/system-info', async () => view('demos.system-info'))

// GET /demos/fibonacci — worker-thread demo via @rudderjs/concurrency.
// GET handler for /api/fib lives in routes/api.ts.
Route.get('/demos/fibonacci', async () => view('demos.fibonacci'))

// GET /demos/sync — Yjs CRDT collaborative editor (@rudderjs/sync).
Route.get('/demos/sync', async () => view('demos.sync'))

// GET /demos/ws — WebSocket chat + presence (@rudderjs/broadcast).
Route.get('/demos/ws', async () => view('demos.ws'))

// GET /demos/cache — Cache.get + Cache.set round-trip (@rudderjs/cache).
Route.get('/demos/cache', async () => view('demos.cache'))

// GET /demos/queue — Job dispatch demo (@rudderjs/queue).
Route.get('/demos/queue', async () => view('demos.queue'))

// GET /demos/mail — Mail send demo (@rudderjs/mail).
Route.get('/demos/mail', async () => view('demos.mail'))

// GET /demos/notifications — multi-channel notification (@rudderjs/notification + mail).
Route.get('/demos/notifications', async () => view('demos.notifications'))

// GET /demos/localization — locale switcher + trans() round-trip (@rudderjs/localization).
Route.get('/demos/localization', async () => view('demos.localization'))

// GET /demos/http — fluent HTTP client (@rudderjs/http) with retry + timeout.
Route.get('/demos/http', async () => view('demos.http'))

// GET /demos/todos — ORM + interactive state. Controller loads initial data,
// view hydrates and POSTs mutations to /api/todos/* for live updates.
Route.get('/demos/todos', async () => {
  const todos = await resolve<TodoService>(TodoService).findAll()
  return view('demos.todos', { todos })
})

// GET /demos/polymorphic — morphMany / morphTo / morphToMany / morphedByMany.
// Posts and videos each have polymorphic comments + a polymorphic many-to-many
// link to a shared Tag table via the `taggable` pivot.
Route.get('/demos/polymorphic', async () => {
  const [posts, videos, tags] = await Promise.all([
    Post.all(),
    Video.all(),
    Tag.all(),
  ])

  type WithRelated = { related(name: string): { get(): Promise<unknown[]> } }

  const hydrate = async <T extends { id: number }>(parent: T & WithRelated) => {
    const [comments, ptags] = await Promise.all([
      parent.related('comments').get() as Promise<Comment[]>,
      parent.related('tags').get()     as Promise<Tag[]>,
    ])
    return {
      ...parent,
      comments: comments.map(c => ({ ...c })),
      tags:     ptags.map(t => ({ ...t })),
    }
  }

  return view('demos.polymorphic', {
    posts:  await Promise.all(posts.map(p  => hydrate(p as Post  & WithRelated))),
    videos: await Promise.all(videos.map(v => hydrate(v as Video & WithRelated))),
    tags:   tags.map(t => ({ ...t })),
  })
})

// GET /demos/pennant — feature flags resolved against the current user.
// Beta sub-route is guarded by FeatureMiddleware('beta-dashboard') and
// only resolves true for user id 1, demonstrating the 403 path.
Route.get('/demos/pennant', async () => {
  const current = await auth().user() as Record<string, unknown> | null

  // Resolve features against the raw user (so scoped resolvers see the id),
  // but pluck a plain object for the view — Vike refuses to serialize Model
  // instances across the SSR boundary.
  const values = await Feature.values(
    ['dark-mode', 'max-uploads', 'beta-dashboard', 'new-checkout'],
    current as { id: string | number; [key: string]: unknown } | null,
  )
  const user = current
    ? { id: String(current['id']), name: String(current['name'] ?? ''), email: String(current['email'] ?? '') }
    : null

  return view('demos.pennant', { user, values })
})

Route.get('/demos/pennant/beta', async () => view('demos.pennant-beta'), [FeatureMiddleware('beta-dashboard')])

// GET /demos/billing — Paddle checkout demo (@rudderjs/cashier-paddle).
Route.get('/demos/billing', async () => {
  const mock = !Cashier.apiKey() || !Cashier.clientSideToken() || !Cashier.webhookSecret()
  const current = await auth().user() as { id: string; email: string; name: string } | null

  let subRecord = null
  if (current) {
    const u = Object.assign(new User(), current)
    const sub = await u.subscription()
    subRecord = sub?.record ?? null
  }
  return view('demos.billing', billingDemoProps(mock, !!current, subRecord))
})

// GET /demos/billing/subscriptions — list/manage existing subscriptions.
Route.get('/demos/billing/subscriptions', async () => {
  const mock = !Cashier.apiKey() || !Cashier.clientSideToken() || !Cashier.webhookSecret()
  const current = await auth().user() as { id: string } | null
  if (!current) return view('demos.billing-subscriptions', billingSubscriptionsProps(mock, []))

  const u = Object.assign(new User(), current)
  const subs = await u.subscriptions()
  return view('demos.billing-subscriptions', billingSubscriptionsProps(mock, subs))
})

// GET /session/demo — increments a visit counter across requests
Route.get('/session/demo', (req, res) => {
  req.session.put('visits', (req.session.get<number>('visits') ?? 0) + 1)
  res.json({ visits: req.session.get('visits') })
})

// GET /test/queries — fires a few ORM queries for telescope testing
Route.get('/test/queries', async (_req, res) => {
  const { User } = await import('../app/Models/User.js')
  const { Todo } = await import('../app/Models/Todo.js')

  const users     = await User.all()
  const firstUser = await User.first()
  const userCount = await User.count()

  const todos      = await Todo.all()
  const firstTodo  = await Todo.first()
  const todoCount  = await Todo.count()
  const todosPage  = await Todo.paginate(1, 5)
  const foundTodo  = firstTodo ? await Todo.find(firstTodo.id) : null

  res.json({
    users:  { total: userCount, first: firstUser?.name ?? null },
    todos:  {
      total: todoCount,
      first: firstTodo?.title ?? null,
      found: foundTodo?.title ?? null,
      page:  { data: todosPage.data.length, total: todosPage.total, perPage: todosPage.perPage },
    },
  })
})

// GET /test/logs — fires log messages for telescope testing
Route.get('/test/logs', async (_req, res) => {
  const { Log } = await import('@rudderjs/log')
  Log.info('User visited the test page')
  Log.warning('Disk space running low', { usage: '89%' })
  Log.error('Payment gateway timeout', { provider: 'stripe', duration: 5000 })
  Log.debug('Cache key resolved', { key: 'users:all', hit: true })
  res.json({ logged: 4 })
})

// GET /test/exception — throws an exception for telescope testing
Route.get('/test/exception', async () => {
  throw new Error('Test exception from /test/exception route')
})

// GET /test/redirect — 302 redirect for telescope Response tab testing
Route.get('/test/redirect', (_req, res) => {
  res.redirect('/', 302)
})

// GET /test/mail — sends a test email for telescope testing
Route.get('/test/mail', async (_req, res) => {
  const { Mail } = await import('@rudderjs/mail')
  const { Mailable } = await import('@rudderjs/mail')

  class TestMail extends Mailable {
    build() {
      return this
        .subject('Telescope Test Email')
        .html('<h1>Hello from Telescope!</h1><p>This is a test email.</p>')
        .text('Hello from Telescope! This is a test email.')
    }
  }

  await Mail.to('test@example.com').send(new TestMail())
  res.json({ sent: true })
})

// GET /test/notification — dispatches the real WelcomeNotification (mail + database channels)
Route.get('/test/notification', async (_req, res) => {
  const { notify } = await import('@rudderjs/notification')
  const { WelcomeNotification } = await import('../app/Notifications/WelcomeNotification.js')

  await notify(
    { id: 'user-1', name: 'Telescope Tester', email: 'test@example.com' },
    new WelcomeNotification(),
  )
  res.json({ notified: true, channels: ['mail', 'database'] })
})

// GET /test/http — fires outgoing HTTP requests for telescope testing
Route.get('/test/http', async (_req, res) => {
  const { Http } = await import('@rudderjs/http')
  const response = await Http.get('https://jsonplaceholder.typicode.com/todos/1')
  res.json({ status: response.status, data: response.json() })
})

// GET /test/model — fires ORM model operations for telescope testing
Route.get('/test/model', async (_req, res) => {
  const { Todo } = await import('../app/Models/Todo.js')
  const todo = await Todo.create({ title: 'Telescope test', completed: false })
  await Todo.update(todo.id, { title: 'Telescope test (updated)' })
  await Todo.delete(todo.id)
  res.json({ created: todo.id })
})

// GET /test/pennant — exercises Feature resolution across scope shapes,
// plus activate/deactivate/purge.
Route.get('/test/pennant', async (_req, res) => {
  const userOne   = { id: 1, name: 'Alice' }
  const userTwo   = { id: 2, name: 'Bob' }

  const beta = {
    forUserOne: await Feature.active('beta-dashboard', userOne),
    forUserTwo: await Feature.active('beta-dashboard', userTwo),
    forNull:    await Feature.active('beta-dashboard', null),
  }

  // activate / deactivate flow
  await Feature.activate('beta-dashboard', userTwo)
  const afterActivate   = await Feature.active('beta-dashboard', userTwo)
  await Feature.deactivate('beta-dashboard', userTwo)
  const afterDeactivate = await Feature.active('beta-dashboard', userTwo)
  await Feature.purge('beta-dashboard')
  const afterPurge      = await Feature.active('beta-dashboard', userOne)

  res.json({
    boolean: await Feature.active('dark-mode'),
    value:   await Feature.value<number>('max-uploads'),
    scoped:  beta,
    activate: { afterActivate, afterDeactivate, afterPurge },
  })
})

// GET /test/gate — fires gate authorization checks for telescope testing.
// The gate decides based on the post's role so we get a real allow + deny
// regardless of whether anyone is signed in.
Route.get('/test/gate', async (_req, res) => {
  const { Gate } = await import('@rudderjs/auth')
  Gate.define('edit-post', (_user, post: { role?: string }) => post?.role === 'admin')
  const allowed = await Gate.allows('edit-post', { id: 1, role: 'admin' })
  const denied  = await Gate.allows('edit-post', { id: 2, role: 'user' })
  res.json({ allowed, denied })
})

// GET /test/dump — fires dump() for telescope testing
Route.get('/test/dump', async (_req, res) => {
  const { dump } = await import('@rudderjs/support')
  dump({ hello: 'world', timestamp: Date.now() })
  dump('simple string dump')
  res.json({ dumped: 2 })
})

// GET /test/event — dispatches the real UserRegistered event,
// which fires SendWelcomeEmailListener → Mail.send(WelcomeEmail)
Route.get('/test/event', async (_req, res) => {
  const { dispatch } = await import('@rudderjs/core')
  const { UserRegistered } = await import('../app/Events/UserRegistered.js')

  // Also dispatch a no-listener event to verify the collector still records it
  class OrderCompleted { constructor(public orderId: number, public total: number) {} }

  await dispatch(new UserRegistered('user-1', 'Telescope Tester', 'test@example.com'))
  await dispatch(new OrderCompleted(42, 99.99))
  res.json({ dispatched: 2 })
})

// GET /test/job — dispatches a queue job for telescope testing
Route.get('/test/job', async (_req, res) => {
  const { WelcomeUserJob } = await import('../app/Jobs/WelcomeUserJob.js')
  await WelcomeUserJob.dispatch('Test User', 'test@example.com').send()
  await WelcomeUserJob.dispatch('Priority User', 'priority@example.com')
    .onQueue('priority')
    .send()
  res.json({ dispatched: 2 })
})

// GET /test/horizon — exercises Horizon's job/queue/worker collectors.
// Dispatches a mix of jobs across queues + a guaranteed failure so the
// dashboard's Recent / Failed / Queues / Workers pages all populate.
// Pair with `pnpm rudder queue:work` in another terminal so a real worker
// process picks up the jobs (BullMQ; needs Redis).
Route.get('/test/horizon', async (_req, res) => {
  const { WelcomeUserJob } = await import('../app/Jobs/WelcomeUserJob.js')
  const { FailingJob }     = await import('../app/Jobs/FailingJob.js')

  // Default queue
  await WelcomeUserJob.dispatch('Alice', 'alice@example.com').send()
  await WelcomeUserJob.dispatch('Bob',   'bob@example.com').send()

  // Priority queue — exercises multi-queue throughput on /horizon/queues
  await WelcomeUserJob.dispatch('VIP', 'vip@example.com').onQueue('priority').send()

  // Always-fails — exhausts retries and lands in /horizon/jobs/failed
  await FailingJob.dispatch('Crash on purpose').send()

  res.json({
    dispatched: 4,
    note:       'Run `pnpm rudder queue:work default,priority` in another terminal to process them.',
  })
})

// GET /test/pulse — exercises every pulse recorder in one request so all
// dashboard cards populate. Slow request (forced sleep), cache hits +
// misses, a recorded exception (caught + re-reported), a job dispatch,
// and an ORM query. The Request + User + Server recorders fire
// automatically on every request — no extra work needed for those.
Route.get('/test/pulse', async (_req, res) => {
  const { Cache } = await import('@rudderjs/cache')
  const { report } = await import('@rudderjs/core')
  const { WelcomeUserJob } = await import('../app/Jobs/WelcomeUserJob.js')
  const { User } = await import('../app/Models/User.js')

  // 1. Cache recorder — hits + misses
  await Cache.set('pulse:warmup', 'value', 60)
  await Cache.get<string>('pulse:warmup')          // hit
  await Cache.get<string>('pulse:nonexistent')     // miss
  await Cache.forget('pulse:warmup')

  // 2. Query recorder — runs an ORM query (counts as request_duration too)
  await User.count()

  // 3. Queue recorder — dispatches a job through the queue adapter
  await WelcomeUserJob.dispatch('Pulse Tester', 'pulse@example.com').send()

  // 4. Exception recorder — report() without re-throwing so the request still 200s
  try {
    throw new Error('Pulse test exception')
  } catch (err) {
    report(err)
  }

  // 5. Slow request recorder — forced delay >slowRequestThreshold (default 1000ms)
  await new Promise(resolve => setTimeout(resolve, 1100))

  res.json({
    cache:     { hit: 1, miss: 1 },
    query:     'User.count()',
    queue:     'WelcomeUserJob dispatched',
    exception: 'reported',
    duration:  '~1100ms (slow_request entry)',
  })
})

// GET /test/cache — fires cache operations for telescope testing
Route.get('/test/cache', async (_req, res) => {
  const { Cache } = await import('@rudderjs/cache')
  await Cache.set('test:greeting', 'Hello from telescope!', 60)
  const hit = await Cache.get<string>('test:greeting')
  const miss = await Cache.get<string>('test:nonexistent')
  await Cache.forget('test:greeting')
  res.json({ hit, miss })
})

// GET /test/mcp — exercises the local MCP server (EchoServer) via JSON-RPC.
// Triggers the MCP observer so Telescope's MCP collector records tool calls.
Route.get('/test/mcp', async (_req, res) => {
  const baseUrl = 'http://localhost:3000/mcp/echo'

  const post = async (body: Record<string, unknown>, sessionId?: string): Promise<{
    sessionId: string | null; data: unknown
  }> => {
    const r = await fetch(baseUrl, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json, text/event-stream',
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify(body),
    })
    const newSessionId = r.headers.get('mcp-session-id') ?? sessionId ?? null
    const text = await r.text()
    // Streamable HTTP responses can be JSON or SSE — handle both
    let data: unknown = null
    if (text.startsWith('event:') || text.includes('\ndata: ')) {
      const dataLine = text.split('\n').find(l => l.startsWith('data: '))
      if (dataLine) data = JSON.parse(dataLine.slice(6))
    } else if (text) {
      try { data = JSON.parse(text) } catch { data = text }
    }
    return { sessionId: newSessionId, data }
  }

  // 1. Initialize the session
  const init = await post({
    jsonrpc: '2.0',
    id:      1,
    method:  'initialize',
    params:  {
      protocolVersion: '2024-11-05',
      capabilities:    {},
      clientInfo:      { name: 'telescope-test', version: '1.0.0' },
    },
  })

  // 2. Acknowledge initialization (notification, no response)
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId ?? undefined)

  // 3. List tools
  const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.sessionId ?? undefined)

  // 4. Call the echo tool
  const call = await post({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'echo', arguments: { name: 'Telescope' } },
  }, init.sessionId ?? undefined)

  res.json({ sessionId: init.sessionId, list: list.data, call: call.data })
})

// GET /test/ai — fires an AI agent execution for telescope testing
Route.get('/test/ai', async (_req, res) => {
  const { agent, toolDefinition } = await import('@rudderjs/ai')
  const { z } = await import('zod')

  const calculator = toolDefinition({
    name: 'calculator',
    description: 'Performs basic math',
    inputSchema: z.object({ expression: z.string() }),
  }).server(({ expression }) => ({ result: eval(expression) })) // eslint-disable-line no-eval

  const mathAgent = agent({
    instructions: 'You are a helpful math assistant. Use the calculator tool.',
    model: 'anthropic/claude-haiku-4-5-20251001',
    tools: [calculator],
  })

  const result = await mathAgent.prompt('What is 2 + 2?')

  res.json({
    text:   result.text,
    steps:  result.steps.length,
    tokens: result.usage?.totalTokens ?? null,
  })
})
