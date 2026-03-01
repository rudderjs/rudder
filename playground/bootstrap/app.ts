import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@forge/core'
import { hono } from '@forge/server-hono'
import { ThrottleMiddleware } from '@forge/middleware'
import { RequestIdMiddleware } from '../app/Middleware/RequestIdMiddleware.ts'
import configs from '../config/index.ts'
import providers from './providers.ts'

export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((m) => {
    // Global middleware — runs on every request (static assets are automatically skipped)
    m.use(new ThrottleMiddleware(60, 60_000).toHandler())  // 60 req/min per IP, API/pages only
    m.use(new RequestIdMiddleware().toHandler())
  })
  .withExceptions((_e) => {
    // future: exception reporting and rendering
  })
  .create()
