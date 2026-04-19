// Auth routes (Laravel Breeze-style) — live in the `web` group because
// sign-in / sign-up / sign-out need session (they call Auth.attempt / Auth.login
// which require the auth ALS that AuthMiddleware sets up). The `/api/auth/...`
// URL prefix is cosmetic; route group membership is determined by file.
import './auth.ts'

import { createRequire } from 'node:module'
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { config } from '@rudderjs/core'
import { CsrfMiddleware } from '@rudderjs/middleware'
import { auth } from '@rudderjs/auth'

// Web middleware — session + AuthMiddleware are auto-installed on the `web`
// group by their providers (see @rudderjs/session, @rudderjs/auth). Only CSRF
// is opt-in per route because some endpoints may need to skip it (webhooks,
// server-to-server callbacks, etc.).
const webMw = [
  CsrfMiddleware(),
]

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
}, webMw)

// Web routes — HTML redirects, guards, and non-API server responses
// These run before Vike's file-based page routing
// Use this file for: redirects, server-side auth guards, download routes, sitemaps, etc.

Route.get('/test-get-route', (_req, res) => {
  res.send('test response')
}, webMw)

// GET /session/demo — increments a visit counter across requests
Route.get('/session/demo', (req, res) => {
  req.session.put('visits', (req.session.get<number>('visits') ?? 0) + 1)
  res.json({ visits: req.session.get('visits') })
}, webMw)

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

// GET /test/gate — fires gate authorization checks for telescope testing
Route.get('/test/gate', async (_req, res) => {
  const { Gate } = await import('@rudderjs/auth')
  Gate.define('edit-post', (user) => (user as unknown as { role?: string }).role === 'admin')
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

// GET /test/cache — fires cache operations for telescope testing
Route.get('/test/cache', async (_req, res) => {
  const { Cache } = await import('@rudderjs/cache')
  await Cache.set('test:greeting', 'Hello from telescope!', 60)
  const hit = await Cache.get<string>('test:greeting')
  const miss = await Cache.get<string>('test:nonexistent')
  await Cache.forget('test:greeting')
  res.json({ hit, miss })
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
