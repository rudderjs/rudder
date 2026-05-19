import { type TemplateContext } from '../../templates.js'

export function routesWeb(ctx: TemplateContext): string {
  const hasAuth     = ctx.packages.auth
  const hasWelcome  = ctx.frameworks.length === 1

  // ── imports ─────────────────────────────────────────────
  const imports: string[] = [`import { Route } from '@rudderjs/router'`]
  if (hasWelcome) {
    imports.push(`import { createRequire } from 'node:module'`)
    imports.push(`import { view } from '@rudderjs/view'`)
    imports.push(`import { config } from '@rudderjs/core'`)
  }
  if (hasAuth) {
    imports.push(`import { CsrfMiddleware } from '@rudderjs/middleware'`)
    imports.push(`import { registerAuthRoutes } from '@rudderjs/auth/routes'`)
    imports.push(`import { AuthController } from '../app/Http/Controllers/AuthController.ts'`)
  }

  // ── middleware chain shared with auth routes + welcome ─
  // SessionMiddleware + AuthMiddleware are auto-installed on the web group by
  // their providers. Only CSRF stays per-route so specific endpoints (webhooks,
  // server-to-server callbacks) can opt out.
  const webMwBlock = hasAuth
    ? `
// Per-route web middleware — session + auth are auto-applied on the web group.
const webMw = [CsrfMiddleware()]
`
    : ''

  // ── auth UI wiring ──────────────────────────────────────
  // GET view pages come from `registerAuthRoutes`; the POST submit handlers
  // come from `AuthController` (extends @rudderjs/auth's BaseAuthController).
  // Both live in routes/web.ts so they inherit SessionMiddleware + AuthMiddleware
  // from the web group. Customize the flow by editing app/Http/Controllers/AuthController.ts.
  const authBlock = hasAuth
    ? `
// GET pages — login/register/forgot-password/reset-password
// Views live in app/Views/Auth/ (vendored from @rudderjs/auth/views/${ctx.primary}/)
registerAuthRoutes(Route, { middleware: webMw })

// POST handlers — sign-in/email, sign-up/email, sign-out, password reset.
// Edit app/Http/Controllers/AuthController.ts to customize.
Route.registerController(AuthController)
`
    : ''

  // ── welcome page wiring ─────────────────────────────────
  // SiteHeader reads `user` from pageContext (set by @rudderjs/auth's enhancer),
  // so the welcome controller no longer needs to pass it as a prop.
  const welcomeBlock = hasWelcome
    ? `
// Read RudderJS version from @rudderjs/core's package.json at boot time.
const _require = createRequire(import.meta.url)
const rudderCorePkg = _require('@rudderjs/core/package.json') as { version: string }

// Welcome page — delete this route and app/Views/Welcome.${welcomeExt(ctx.primary)} to replace it.
Route.get('/', async () => view('welcome', {
  appName:       config<string>('app.name', 'RudderJS'),
  rudderVersion: rudderCorePkg.version,
  nodeVersion:   process.version.replace(/^v/, ''),
  env:           config<string>('app.env', 'development'),
})${hasAuth ? ', webMw' : ''})
`
    : ''

  return `${imports.join('\n')}
${webMwBlock}${authBlock}${welcomeBlock}
// Web routes — HTML redirects, guards, and non-API server responses
// These run before Vike's file-based page routing
// Use this file for: redirects, server-side auth guards, download routes, sitemaps, etc.
`
}

export function welcomeExt(fw: 'react' | 'vue' | 'solid'): string {
  return fw === 'vue' ? 'vue' : 'tsx'
}
