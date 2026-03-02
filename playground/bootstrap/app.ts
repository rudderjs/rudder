import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@forge/core'
import { hono } from '@forge/server-hono'
import { RateLimit } from '@forge/rate-limit'
import { RequestIdMiddleware } from '../app/Middleware/RequestIdMiddleware.ts'
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
  })
  .withMiddleware((m) => {
    // Global rate limit — cache-backed, persists across restarts
    m.use(RateLimit.perMinute(60).toHandler())
    m.use(new RequestIdMiddleware().toHandler())
  })
  .withExceptions((_e) => {
    // future: exception reporting and rendering
  })
  .create()
