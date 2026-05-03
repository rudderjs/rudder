import { detectPackageManager, pmExec, pmInstall, pmRun, pageExt, type PackageManager } from './templates/package-managers.js'
import { indexCss } from './templates/css/index.js'
import { prismaConfig } from './templates/prisma/config.js'
import { prismaBase } from './templates/prisma/base.js'
import { prismaAuth } from './templates/prisma/auth.js'
import { prismaNotification } from './templates/prisma/notification.js'
import { prismaPassport } from './templates/prisma/passport.js'
import { configApp } from './templates/configs/app.js'
import { configServer } from './templates/configs/server.js'
import { configLog } from './templates/configs/log.js'
import { configHash } from './templates/configs/hash.js'
import { configDatabase } from './templates/configs/database.js'
import { configQueue } from './templates/configs/queue.js'
import { configMail } from './templates/configs/mail.js'
import { configCache } from './templates/configs/cache.js'
import { configStorage } from './templates/configs/storage.js'
import { configAuth } from './templates/configs/auth.js'
import { configIndex } from './templates/configs/index.js'
import { configSession } from './templates/configs/session.js'
import { configAi } from './templates/configs/ai.js'
import { configSync } from './templates/configs/sync.js'
import { configPassport } from './templates/configs/passport.js'
import { configLocalization } from './templates/configs/localization.js'
import { configTelescope } from './templates/configs/telescope.js'
import { dotenv, dotenvExample, envDts, gitignore, pnpmWorkspace } from './templates/env.js'
import { serverTs } from './templates/server.js'
import { bootstrapApp } from './templates/bootstrap/app.js'
import { bootstrapProviders } from './templates/bootstrap/providers.js'
import { userModel } from './templates/app/user-model.js'
import { appServiceProvider } from './templates/app/service-provider.js'
import { mcpEchoServer } from './templates/app/mcp-echo-server.js'
import { mcpEchoTool } from './templates/app/mcp-echo-tool.js'
import { authController } from './templates/app/auth-controller.js'
import { routesApi } from './templates/routes/api.js'
import { routesWeb, welcomeExt } from './templates/routes/web.js'
import { routesConsole } from './templates/routes/console.js'
import { pagesRootConfig, pagesIndexConfig, pagesIndexData, pagesIndexPage } from './templates/pages/index.js'
import { welcomeView } from './templates/views/welcome.js'
import { pagesErrorConfig, pagesErrorPage } from './templates/pages/error.js'
import { aiChatPageConfig, aiChatPage } from './templates/pages/ai-chat.js'
import { demoPageConfig, demoPage } from './templates/pages/demo.js'
import { demosIndexView } from './templates/demos/index-view.js'
import { demosContactView } from './templates/demos/contact.js'
import { demosWsView } from './templates/demos/ws.js'
import { demosLiveView } from './templates/demos/live.js'
import { bkSocketSource } from './templates/demos/bk-socket.js'
import { packageJson } from './templates/package-json.js'
import { tsconfigJson } from './templates/tsconfig.js'
import { viteConfig } from './templates/vite.js'

export { detectPackageManager, pmExec, pmInstall, pmRun }
export type { PackageManager }

export interface TemplateContext {
  name:       string
  db:         'sqlite' | 'postgresql' | 'mysql'
  orm:        'prisma' | 'drizzle' | false
  authSecret: string
  frameworks: ('react' | 'vue' | 'solid')[]
  primary:    'react' | 'vue' | 'solid'
  tailwind:   boolean
  shadcn:     boolean
  pm:         PackageManager
  packages: {
    auth:          boolean
    sanctum:       boolean
    passport:      boolean
    socialite:     boolean
    queue:         boolean
    storage:       boolean
    scheduler:     boolean
    image:         boolean
    mail:          boolean
    notifications: boolean
    broadcast:     boolean
    sync:          boolean
    ai:            boolean
    mcp:           boolean
    boost:         boolean
    localization:  boolean
    cashierPaddle: boolean
    pennant:       boolean
    telescope:     boolean
    pulse:         boolean
    horizon:       boolean
    crypt:         boolean
    http:          boolean
    process:       boolean
    concurrency:   boolean
    demos:         boolean
  }
}

export function getTemplates(ctx: TemplateContext): Record<string, string> {
  const files: Record<string, string> = {}

  files['package.json']         = packageJson(ctx)
  if (ctx.pm === 'pnpm') {
    files['pnpm-workspace.yaml'] = pnpmWorkspace()
  }
  files['tsconfig.json']        = tsconfigJson(ctx)
  files['vite.config.ts']       = viteConfig(ctx)
  files['+server.ts']           = serverTs()
  files['.env']                 = dotenv(ctx)
  files['.env.example']         = dotenvExample(ctx)
  files['.gitignore']           = gitignore()

  // Database schema
  if (ctx.orm === 'prisma') {
    files['prisma.config.ts']            = prismaConfig(ctx)
    files['prisma/schema/base.prisma']   = prismaBase(ctx)
    if (ctx.packages.auth)          files['prisma/schema/auth.prisma']         = prismaAuth()
    if (ctx.packages.passport)      files['prisma/schema/passport.prisma']     = prismaPassport()
    if (ctx.packages.notifications) files['prisma/schema/notification.prisma'] = prismaNotification()
    files['prisma/schema/modules.prisma'] = '// <rudderjs:modules:start>\n// <rudderjs:modules:end>\n'
  }

  files['src/index.css'] = indexCss(ctx)

  files['bootstrap/app.ts']       = bootstrapApp(ctx)
  files['bootstrap/providers.ts'] = bootstrapProviders(ctx)

  // Config files — always generated (Tier A silent install + framework defaults)
  files['config/app.ts']      = configApp()
  files['config/server.ts']   = configServer()
  files['config/log.ts']      = configLog()
  files['config/session.ts']  = configSession()
  files['config/hash.ts']     = configHash()
  files['config/cache.ts']    = configCache()

  // Config files — conditional on selected packages
  if (ctx.orm)                    files['config/database.ts'] = configDatabase(ctx)
  if (ctx.packages.auth)         files['config/auth.ts']     = configAuth(ctx)
  if (ctx.packages.queue)        files['config/queue.ts']    = configQueue()
  if (ctx.packages.mail)         files['config/mail.ts']     = configMail()
  if (ctx.packages.storage)      files['config/storage.ts']  = configStorage()
  if (ctx.packages.ai)           files['config/ai.ts']       = configAi()
  if (ctx.packages.sync)         files['config/sync.ts']     = configSync(ctx)
  if (ctx.packages.passport)     files['config/passport.ts'] = configPassport()
  if (ctx.packages.localization) files['config/localization.ts'] = configLocalization()
  if (ctx.packages.telescope)    files['config/telescope.ts'] = configTelescope()

  files['config/index.ts']    = configIndex(ctx)
  files['env.d.ts']           = envDts()

  if (ctx.packages.auth && ctx.orm) files['app/Models/User.ts'] = userModel()
  if (ctx.packages.auth) files['app/Http/Controllers/AuthController.ts'] = authController()
  files['app/Providers/AppServiceProvider.ts']  = appServiceProvider(ctx)

  if (ctx.packages.mcp) {
    files['app/Mcp/EchoServer.ts'] = mcpEchoServer()
    files['app/Mcp/EchoTool.ts']   = mcpEchoTool()
  }

  files['routes/api.ts']     = routesApi(ctx)
  files['routes/web.ts']     = routesWeb(ctx)
  files['routes/console.ts'] = routesConsole()

  const ext = pageExt(ctx.primary)
  files['pages/+config.ts']              = pagesRootConfig(ctx)
  if (ctx.frameworks.length === 1) {
    // Single-framework projects use a controller view for `/` — rendered
    // through @rudderjs/view and wired in routes/web.ts. The file lives in
    // app/Views/ and is owned by the user from day one.
    files[`app/Views/Welcome.${welcomeExt(ctx.primary)}`] = welcomeView(ctx)
  } else {
    // Multi-framework projects keep pages/index/+Page.* with a per-page
    // +config.ts that picks the primary renderer. The view scanner can't
    // resolve a single framework when multiple vike-* are installed, so
    // @rudderjs/view isn't usable in that setup yet.
    files['pages/index/+config.ts']      = pagesIndexConfig(ctx)
    files['pages/index/+data.ts']        = pagesIndexData(ctx)
    files[`pages/index/+Page${ext}`]     = pagesIndexPage(ctx)
  }
  files['pages/_error/+config.ts']       = pagesErrorConfig(ctx)
  files[`pages/_error/+Page${ext}`]      = pagesErrorPage(ctx)

  if (ctx.packages.ai) {
    files['pages/ai-chat/+config.ts']        = aiChatPageConfig(ctx)
    files[`pages/ai-chat/+Page${ext}`]       = aiChatPage(ctx)
  }

  for (const fw of ctx.frameworks.filter(f => f !== ctx.primary)) {
    const dext = pageExt(fw)
    files[`pages/${fw}-demo/+config.ts`]   = demoPageConfig(fw)
    files[`pages/${fw}-demo/+Page${dext}`] = demoPage(fw, ctx)
  }

  // Demos — react primary only; ws/live require their respective packages.
  if (shouldScaffoldDemos(ctx)) {
    files['app/Views/Demos/Index.tsx']   = demosIndexView(ctx)
    files['app/Views/Demos/Contact.tsx'] = demosContactView(ctx)
    if (ctx.packages.broadcast) {
      files['app/Views/Demos/Ws.tsx'] = demosWsView()
      files['src/BKSocket.ts']        = bkSocketSource()
    }
    if (ctx.packages.sync) {
      files['app/Views/Demos/Live.tsx'] = demosLiveView()
    }
  }

  return files
}

/** Demos are React-primary only for v1 — vue/solid variants aren't written yet. */
export function shouldScaffoldDemos(ctx: TemplateContext): boolean {
  return ctx.packages.demos && ctx.primary === 'react'
}



















