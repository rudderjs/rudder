import { shouldScaffoldAnyDemo, shouldScaffoldDemo, type TemplateContext } from '../../templates.js'

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
    imports.push(`import { auth } from '@rudderjs/auth'`)
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
  const welcomeBlock = hasWelcome
    ? `
// Read RudderJS version from @rudderjs/core's package.json at boot time.
const _require = createRequire(import.meta.url)
const rudderCorePkg = _require('@rudderjs/core/package.json') as { version: string }

// Welcome page — delete this route and app/Views/Welcome.${welcomeExt(ctx.primary)} to replace it.
Route.get('/', async () => {${hasAuth ? `
  // Resolve the current user (if signed in) — AuthMiddleware auto-installs on
  // the web group, so auth() has a populated ALS context here.
  const current = await auth().user() as Record<string, unknown> | null
  const user    = current
    ? { name: String(current['name'] ?? ''), email: String(current['email'] ?? '') }
    : null` : `
  // Auth is not installed, so the welcome page never shows a signed-in user.
  const user = null`}
  return view('welcome', {
    appName:       config<string>('app.name', 'RudderJS'),
    rudderVersion: rudderCorePkg.version,
    nodeVersion:   process.version.replace(/^v/, ''),
    env:           config<string>('app.env', 'development'),
    user,
    // Laravel's Route::has() — the welcome nav renders Log in / Register links
    // only when the auth package registered these named routes. Install
    // @rudderjs/auth + call registerAuthRoutes() and they appear automatically;
    // uninstall and they vanish. No scaffold-time flag.
    loginUrl:    Route.getNamedRoute('login')    ?? null,
    registerUrl: Route.getNamedRoute('register') ?? null,
  })
}${hasAuth ? ', webMw' : ''})
`
    : ''

  // ── demos wiring ────────────────────────────────────────
  // Controllers for /demos and /demos/<name>. Views live under app/Views/Demos/.
  let demosBlock = ''
  if (shouldScaffoldAnyDemo(ctx)) {
    if (!hasWelcome) {
      // Demo files exist but routesWeb already has `view` imports if hasWelcome.
      // For multi-framework projects (no welcome) we still need the view import here.
      imports.push(`import { view } from '@rudderjs/view'`)
    }
    const lines = [
      `// Demos — see app/Views/Demos/`,
      `Route.get('/demos',         async () => view('demos.index'))`,
    ]
    if (shouldScaffoldDemo(ctx, 'contact')) lines.push(`Route.get('/demos/contact', async () => view('demos.contact'))`)
    if (shouldScaffoldDemo(ctx, 'ws'))      lines.push(`Route.get('/demos/ws',      async () => view('demos.ws'))`)
    if (shouldScaffoldDemo(ctx, 'live'))    lines.push(`Route.get('/demos/live',    async () => view('demos.live'))`)
    demosBlock = '\n' + lines.join('\n') + '\n'
  }

  return `${imports.join('\n')}
${webMwBlock}${authBlock}${welcomeBlock}${demosBlock}
// Web routes — HTML redirects, guards, and non-API server responses
// These run before Vike's file-based page routing
// Use this file for: redirects, server-side auth guards, download routes, sitemaps, etc.
`
}

export function welcomeExt(fw: 'react' | 'vue' | 'solid'): string {
  return fw === 'vue' ? 'vue' : 'tsx'
}
