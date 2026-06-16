import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { RateLimit, CsrfMiddleware } from '@rudderjs/middleware'
import { requestIdMiddleware } from 'App/Http/Middleware/RequestIdMiddleware.ts'
import { AppError } from 'App/Exceptions/AppError.ts'
import config from '../config/index.ts'
import providers from './providers.ts'

export default Application.configure({ config, providers })
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
    channels: () => import('../routes/channels.ts'),
  })
  .withMiddleware((m) => {
    // Global middleware — runs on every request, regardless of route group
    m.use(requestIdMiddleware)

    // Per-group middleware. Rate limits are skipped under RUDDER_BENCH=1 so the
    // realistic-workload bench (playground/bench/realistic.mjs) measures real
    // request work instead of 429 rejections once it exceeds the per-minute cap.
    if (process.env['RUDDER_BENCH'] !== '1') {
      m.web(RateLimit.perMinute(120))
      m.api(RateLimit.perMinute(60))
    }
    // Paddle webhooks live in the web group (registered in routes/web.ts)
    // but arrive without a CSRF token — Paddle is the sender, not a browser form.
    m.web(CsrfMiddleware({ exclude: ['/paddle/webhook'] }))

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
