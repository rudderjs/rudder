import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
import { RateLimit } from '@rudderjs/middleware'
import { requestIdMiddleware } from '../app/Middleware/RequestIdMiddleware.ts'
import { AppError } from '../app/Exceptions/AppError.ts'
import configs from '../config/index.ts'
import providers from './providers.ts'

export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
    channels: () => import('../routes/channels.ts'),
  })
  .withMiddleware((m) => {
    // Global middleware — runs on every request, regardless of route group
    m.use(requestIdMiddleware)

    // Per-group middleware
    m.web(RateLimit.perMinute(120).toHandler())
    m.api(RateLimit.perMinute(60).toHandler())

    // Session + AuthMiddleware are auto-installed on the web group by the
    // session/auth providers — no manual wiring needed.
  })
  .withExceptions((e) => {
    // AppError → JSON response using its statusCode and code fields.
    // ValidationError is handled automatically (422) — no entry needed here.
    e.render(AppError, (err) =>
      new Response(JSON.stringify(err.toJSON()), {
        status:  err.statusCode,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  })
  .create()
