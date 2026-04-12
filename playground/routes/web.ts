import { createRequire } from 'node:module'
import { Route } from '@rudderjs/router'
import { view } from '@rudderjs/view'
import { config } from '@rudderjs/core'
import { CsrfMiddleware } from '@rudderjs/middleware'
import { SessionMiddleware } from '@rudderjs/session'
import { auth } from '@rudderjs/auth'

// Web middleware — session + CSRF apply to all web routes (not API)
const webMw = [
  SessionMiddleware(),
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
  const users = await User.all()
  res.json({ total: users.length })
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

// GET /test/notification — dispatches a test notification for telescope testing
Route.get('/test/notification', async (_req, res) => {
  const { Notification } = await import('@rudderjs/notification')
  await Notification.send({ id: 'user-1', email: 'test@example.com' }, {
    via: ['mail'],
    toMail: () => ({
      subject: 'Telescope Test Notification',
      html: '<p>You have a new notification!</p>',
    }),
  })
  res.json({ notified: true })
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
