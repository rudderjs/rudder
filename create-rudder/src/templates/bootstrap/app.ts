import type { TemplateContext } from '../../templates.js'

export function bootstrapApp(ctx: TemplateContext): string {
  const imports: string[] = [
    "import 'reflect-metadata'",
    "import 'dotenv/config'",
    "import { Application } from '@rudderjs/core'",
    "import { hono } from '@rudderjs/server-hono'",
    "import { RateLimit } from '@rudderjs/middleware'",
    "import configs from '../config/index.ts'",
    "import providers from './providers.ts'",
  ]
  void ctx

  // Note (middleware groups):
  //   - m.use(...) runs on every request regardless of route group
  //   - m.web(...) / m.api(...) run only on routes loaded via withRouting({ web }) / { api }
  //   - sessionMiddleware + AuthMiddleware are auto-installed on the web group
  //     by @rudderjs/session and @rudderjs/auth — no manual wiring needed

  return `${imports.join('\n')}

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
    // Per-group — separate rate-limit budgets for web pages and api calls
    m.web(RateLimit.perMinute(120))
    m.api(RateLimit.perMinute(60))

    // sessionMiddleware + AuthMiddleware are auto-installed on the web group
    // by @rudderjs/session and @rudderjs/auth. Api routes are stateless by
    // default — opt into bearer auth with RequireBearer() from @rudderjs/passport.
  })
  .create()
`
}
