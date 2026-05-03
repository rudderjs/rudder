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
    if (shouldScaffoldDemo(ctx, 'todos')) {
      imports.push(`import { resolve } from '@rudderjs/core'`)
      imports.push(`import { TodoService } from '../app/Modules/Todo/TodoService.ts'`)
    }
    if (shouldScaffoldDemo(ctx, 'pennant')) {
      imports.push(`import { Feature, FeatureMiddleware } from '@rudderjs/pennant'`)
      // auth().user() — Pennant demo gates on `auth` so the import is always available
      // when this branch fires; it's also already imported above when hasAuth.
    }
    const lines = [
      `// Demos — see app/Views/Demos/`,
      `Route.get('/demos',         async () => view('demos.index'))`,
    ]
    if (shouldScaffoldDemo(ctx, 'contact'))     lines.push(`Route.get('/demos/contact', async () => view('demos.contact'))`)
    if (shouldScaffoldDemo(ctx, 'todos')) {
      lines.push(`Route.get('/demos/todos',   async () => {`)
      lines.push(`  const todos = await resolve<TodoService>(TodoService).findAll()`)
      lines.push(`  return view('demos.todos', { todos })`)
      lines.push(`})`)
    }
    if (shouldScaffoldDemo(ctx, 'avatar'))        lines.push(`Route.get('/demos/avatar',        async () => view('demos.avatar'))`)
    if (shouldScaffoldDemo(ctx, 'fibonacci'))     lines.push(`Route.get('/demos/fibonacci',     async () => view('demos.fibonacci'))`)
    if (shouldScaffoldDemo(ctx, 'system-info'))   lines.push(`Route.get('/demos/system-info',   async () => view('demos.system-info'))`)
    if (shouldScaffoldDemo(ctx, 'cache'))         lines.push(`Route.get('/demos/cache',         async () => view('demos.cache'))`)
    if (shouldScaffoldDemo(ctx, 'queue'))         lines.push(`Route.get('/demos/queue',         async () => view('demos.queue'))`)
    if (shouldScaffoldDemo(ctx, 'mail'))          lines.push(`Route.get('/demos/mail',          async () => view('demos.mail'))`)
    if (shouldScaffoldDemo(ctx, 'notifications')) lines.push(`Route.get('/demos/notifications', async () => view('demos.notifications'))`)
    if (shouldScaffoldDemo(ctx, 'localization'))  lines.push(`Route.get('/demos/localization',  async () => view('demos.localization'))`)
    if (shouldScaffoldDemo(ctx, 'http'))          lines.push(`Route.get('/demos/http',          async () => view('demos.http'))`)
    if (shouldScaffoldDemo(ctx, 'pennant')) {
      lines.push(`Route.get('/demos/pennant', async () => {`)
      lines.push(`  const current = await auth().user() as Record<string, unknown> | null`)
      lines.push(`  const values = await Feature.values(`)
      lines.push(`    ['dark-mode', 'max-uploads', 'beta-dashboard', 'new-checkout'],`)
      lines.push(`    current as { id: string | number; [k: string]: unknown } | null,`)
      lines.push(`  )`)
      lines.push(`  const user = current`)
      lines.push(`    ? { id: String(current['id']), name: String(current['name'] ?? ''), email: String(current['email'] ?? '') }`)
      lines.push(`    : null`)
      lines.push(`  return view('demos.pennant', { user, values })`)
      lines.push(`})`)
      lines.push(`Route.get('/demos/pennant/beta', async () => view('demos.pennant-beta'), [FeatureMiddleware('beta-dashboard')])`)
    }
    if (shouldScaffoldDemo(ctx, 'ws'))          lines.push(`Route.get('/demos/ws',      async () => view('demos.ws'))`)
    if (shouldScaffoldDemo(ctx, 'sync'))        lines.push(`Route.get('/demos/sync',    async () => view('demos.sync'))`)
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
