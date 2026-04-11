import { execSync } from 'node:child_process'

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

export interface TemplateContext {
  name:       string
  db:         'sqlite' | 'postgresql' | 'mysql'
  orm:        'prisma' | 'drizzle' | false
  withTodo:   boolean
  authSecret: string
  frameworks: ('react' | 'vue' | 'solid')[]
  primary:    'react' | 'vue' | 'solid'
  tailwind:   boolean
  shadcn:     boolean
  pm:         PackageManager
  packages: {
    auth:          boolean
    cache:         boolean
    queue:         boolean
    storage:       boolean
    mail:          boolean
    notifications: boolean
    scheduler:     boolean
    broadcast:     boolean
    live:          boolean
    ai:            boolean
    localization:  boolean
  }
}

/** Detect which package manager invoked the installer.
 *  1. Check npm_config_user_agent (set by pnpm/npm/yarn/bun create commands)
 *  2. Fall back to checking which binaries are available on PATH
 */
export function detectPackageManager(): PackageManager {
  const ua = process.env['npm_config_user_agent'] ?? ''
  if (ua.startsWith('bun'))  return 'bun'
  if (ua.startsWith('yarn')) return 'yarn'
  if (ua.startsWith('pnpm')) return 'pnpm'
  if (ua.startsWith('npm'))  return 'npm'

  // Fallback: check which binaries exist on PATH (preference: pnpm > bun > yarn > npm)
  for (const pm of ['pnpm', 'bun', 'yarn'] as const) {
    try {
      execSync(`${pm} --version`, { stdio: 'ignore' })
      return pm
    } catch { /* not found */ }
  }
  return 'npm'
}

/** `<pm> exec <bin>` equivalent per package manager. */
export function pmExec(pm: PackageManager, bin: string): string {
  if (pm === 'bun')  return `bunx ${bin}`
  if (pm === 'yarn') return `yarn dlx ${bin}`
  if (pm === 'npm')  return `npx ${bin}`
  return `pnpm exec ${bin}`
}

/** `<pm> run <script>` equivalent (yarn/bun allow omitting "run"). */
export function pmRun(pm: PackageManager, script: string): string {
  if (pm === 'npm') return `npm run ${script}`
  return `${pm} ${script}`
}

/** `<pm> install` command. */
export function pmInstall(pm: PackageManager): string {
  return `${pm} install`
}

function pageExt(fw: 'react' | 'vue' | 'solid'): '.tsx' | '.vue' {
  return fw === 'vue' ? '.vue' : '.tsx'
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
    if (ctx.packages.notifications) files['prisma/schema/notification.prisma'] = prismaNotification()
    if (ctx.withTodo)               files['prisma/schema/todo.prisma']         = prismaTodo()
    files['prisma/schema/modules.prisma'] = '// <rudderjs:modules:start>\n// <rudderjs:modules:end>\n'
  }

  if (ctx.tailwind) {
    files['src/index.css'] = indexCss(ctx)
  }

  files['bootstrap/app.ts']       = bootstrapApp(ctx)
  files['bootstrap/providers.ts'] = bootstrapProviders(ctx)

  // Config files — always generated
  files['config/app.ts']      = configApp()
  files['config/server.ts']   = configServer()
  files['config/log.ts']      = configLog()

  // Config files — conditional on selected packages
  if (ctx.orm)                    files['config/database.ts'] = configDatabase(ctx)
  if (ctx.packages.auth)         files['config/auth.ts']     = configAuth(ctx)
  if (ctx.packages.auth)         files['config/session.ts']  = configSession()
  if (ctx.packages.auth)         files['config/hash.ts']     = configHash()
  if (ctx.packages.queue)        files['config/queue.ts']    = configQueue()
  if (ctx.packages.mail)         files['config/mail.ts']     = configMail()
  if (ctx.packages.cache)        files['config/cache.ts']    = configCache()
  if (ctx.packages.storage)      files['config/storage.ts']  = configStorage()
  if (ctx.packages.ai)           files['config/ai.ts']       = configAi()

  files['config/index.ts']    = configIndex(ctx)
  files['env.d.ts']           = envDts()

  if (ctx.packages.auth && ctx.orm) files['app/Models/User.ts'] = userModel()
  files['app/Providers/AppServiceProvider.ts']  = appServiceProvider()
  files['app/Middleware/RequestIdMiddleware.ts'] = requestIdMiddleware()

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

  if (ctx.withTodo) {
    files['app/Modules/Todo/TodoSchema.ts']          = todoSchema()
    files['app/Modules/Todo/TodoService.ts']         = todoService()
    files['app/Modules/Todo/TodoServiceProvider.ts'] = todoServiceProvider()
    files['pages/todos/+config.ts']                  = todoPageConfig(ctx)
    files['pages/todos/+data.ts']                    = todoPageData()
    files[`pages/todos/+Page${ext}`]                 = todoPage(ctx)
  }

  if (ctx.packages.ai) {
    files['pages/ai-chat/+config.ts']        = aiChatPageConfig(ctx)
    files[`pages/ai-chat/+Page${ext}`]       = aiChatPage(ctx)
  }

  for (const fw of ctx.frameworks.filter(f => f !== ctx.primary)) {
    const dext = pageExt(fw)
    files[`pages/${fw}-demo/+config.ts`]   = demoPageConfig(fw)
    files[`pages/${fw}-demo/+Page${dext}`] = demoPage(fw, ctx)
  }

  return files
}

// ─── package.json ──────────────────────────────────────────

function packageJson(ctx: TemplateContext): string {
  const { frameworks, tailwind, shadcn, db } = ctx
  const hasReact = frameworks.includes('react')
  const hasVue   = frameworks.includes('vue')
  const hasSolid = frameworks.includes('solid')

  const dbDeps: Record<string, Record<string, string>> = {
    sqlite:     { 'better-sqlite3': '^12.0.0' },
    postgresql: {},
    mysql:      {},
  }
  const dbDevDeps: Record<string, Record<string, string>> = {
    sqlite:     { '@types/better-sqlite3': '^7.6.0' },
    postgresql: {},
    mysql:      {},
  }

  const frameworkDeps: Record<string, string> = {}
  const frameworkDevDeps: Record<string, string> = {}

  if (hasReact) {
    frameworkDeps['react']      = '^19.0.0'
    frameworkDeps['react-dom']  = '^19.0.0'
    frameworkDeps['vike-react'] = '^0.6.20'
    frameworkDevDeps['@vitejs/plugin-react'] = '^4.3.4'
    frameworkDevDeps['@types/react']         = '^19.0.0'
    frameworkDevDeps['@types/react-dom']     = '^19.0.0'
  }
  if (hasVue) {
    frameworkDeps['vue']      = '^3.5.0'
    frameworkDeps['vike-vue'] = 'latest'
    frameworkDevDeps['@vitejs/plugin-vue'] = '^5.2.0'
  }
  if (hasSolid) {
    frameworkDeps['solid-js']   = '^1.9.0'
    frameworkDeps['vike-solid'] = 'latest'
  }

  const tailwindDeps: Record<string, string> = tailwind ? {
    'tailwindcss':       '^4.2.1',
    '@tailwindcss/vite': '^4.2.1',
  } : {}
  const tailwindDevDeps: Record<string, string> = tailwind ? {
    'tw-animate-css': '^1.4.0',
  } : {}

  const shadcnDeps: Record<string, string> = shadcn ? {
    'class-variance-authority': '^0.7.1',
    'clsx':                     '^2.1.1',
    'tailwind-merge':           '^3.5.0',
    'lucide-react':             '^0.575.0',
  } : {}
  const shadcnDevDeps: Record<string, string> = shadcn ? {
    'shadcn': 'latest',
  } : {}

  // Base framework deps (always included)
  const deps: Record<string, string> = {
    '@rudderjs/rudder':      'latest',
    '@rudderjs/vite':         'latest',
    '@rudderjs/contracts':    'latest',
    '@rudderjs/core':         'latest',
    '@rudderjs/log':          'latest',
    '@rudderjs/middleware':   'latest',
    '@rudderjs/router':       'latest',
    '@rudderjs/server-hono':  'latest',
    '@rudderjs/support':      'latest',
    '@vikejs/hono':           '^0.2.0',
    'dotenv':                 '^16.4.0',
    'reflect-metadata':       '^0.2.2',
    'vike':                   '^0.4.257',
    'zod':                    '^4.0.0',
    ...frameworkDeps,
    ...tailwindDeps,
    ...shadcnDeps,
    ...dbDeps[db],
  }

  // ORM deps
  if (ctx.orm === 'prisma') {
    deps['@rudderjs/orm']        = 'latest'
    deps['@rudderjs/orm-prisma'] = 'latest'
    deps['@prisma/client']       = '^7.0.0'
  } else if (ctx.orm === 'drizzle') {
    deps['@rudderjs/orm']         = 'latest'
    deps['@rudderjs/orm-drizzle'] = 'latest'
  }

  // Optional package deps
  if (ctx.packages.auth)         { deps['@rudderjs/auth'] = 'latest'; deps['@rudderjs/session'] = 'latest'; deps['@rudderjs/hash'] = 'latest' }
  if (ctx.packages.cache)         deps['@rudderjs/cache']        = 'latest'
  if (ctx.packages.queue)         deps['@rudderjs/queue']        = 'latest'
  if (ctx.packages.storage)       deps['@rudderjs/storage']      = 'latest'
  if (ctx.packages.mail)          deps['@rudderjs/mail']         = 'latest'
  if (ctx.packages.notifications) deps['@rudderjs/notification'] = 'latest'
  if (ctx.packages.scheduler)     deps['@rudderjs/schedule']     = 'latest'
  if (ctx.packages.broadcast)     deps['@rudderjs/broadcast']    = 'latest'
  if (ctx.packages.live)          deps['@rudderjs/live']         = 'latest'
  if (ctx.packages.ai)            deps['@rudderjs/ai']           = 'latest'
  if (ctx.packages.localization)  deps['@rudderjs/localization'] = 'latest'
  const devDeps: Record<string, string> = {
    '@rudderjs/cli': 'latest',
    '@types/node':   '^20.0.0',
    'tsx':           '^4.21.0',
    'typescript':    '^5.4.0',
    'vite':          '^7.1.0',
    ...frameworkDevDeps,
    ...tailwindDevDeps,
    ...shadcnDevDeps,
    ...dbDevDeps[db],
  }
  if (ctx.orm === 'prisma') devDeps['prisma'] = '^7.0.0'

  const builtDeps: string[] = ['esbuild']
  if (ctx.orm === 'prisma') { builtDeps.push('@prisma/engines', 'prisma') }
  if (db === 'sqlite') builtDeps.unshift('better-sqlite3')

  const pmField: Record<string, unknown> = {}
  if (ctx.pm === 'pnpm') {
    pmField['pnpm'] = { onlyBuiltDependencies: builtDeps }
  } else if (ctx.pm === 'bun') {
    pmField['trustedDependencies'] = builtDeps
  }
  // npm and yarn allow all lifecycle scripts by default — no extra field needed

  return JSON.stringify({
    name:    ctx.name,
    version: '0.0.1',
    private: true,
    type:    'module',
    scripts: {
      dev:          'vike dev',
      'dev:clean':  'pids=$(lsof -ti :24678 -ti :3000 2>/dev/null); if [ -n "$pids" ]; then kill -9 $pids; fi; vike dev',
      build:        'vike build',
      start:        'node ./dist/server/index.mjs',
      preview:      'node ./dist/server/index.mjs',
      typecheck:    'tsc --noEmit',
      rudder:      'tsx node_modules/@rudderjs/cli/src/index.ts',
    },
    ...pmField,
    dependencies:    deps,
    devDependencies: devDeps,
  }, null, 2) + '\n'
}

// ─── tsconfig.json ─────────────────────────────────────────

function tsconfigJson(ctx: TemplateContext): string {
  const hasReact = ctx.frameworks.includes('react')
  const hasSolid = ctx.frameworks.includes('solid')

  const compilerOptions: Record<string, unknown> = {
    target:                     'ES2022',
    module:                     'ESNext',
    moduleResolution:           'bundler',
    lib:                        ['ES2022', 'DOM', 'DOM.Iterable'],
    strict:                     true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess:   true,
    experimentalDecorators:     true,
    emitDecoratorMetadata:      true,
    skipLibCheck:               true,
    noEmit:                     true,
    baseUrl:                    '.',
    paths:                      { '@/*': ['./src/*'], 'App/*': ['./app/*'] },
    allowImportingTsExtensions: true,
  }

  if (hasReact) {
    compilerOptions['jsx'] = 'react-jsx'
  } else if (hasSolid) {
    compilerOptions['jsx']             = 'preserve'
    compilerOptions['jsxImportSource'] = 'solid-js'
  }
  // Vue only — no jsx field needed

  return JSON.stringify({
    compilerOptions,
    include: ['src/**/*', 'pages/**/*', 'app/**/*', 'bootstrap/**/*', 'routes/**/*', 'config/**/*', '*.ts', '*.tsx'],
  }, null, 2) + '\n'
}

// ─── vite.config.ts ────────────────────────────────────────

function viteConfig(ctx: TemplateContext): string {
  const { frameworks, primary, tailwind } = ctx
  const hasReact = frameworks.includes('react')
  const hasVue   = frameworks.includes('vue')
  const hasSolid = frameworks.includes('solid')
  const hasReactSolidConflict = hasReact && hasSolid

  const imports: string[] = [
    `import { defineConfig } from 'vite'`,
    `import rudderjs from '@rudderjs/vite'`,
  ]
  if (tailwind) imports.push(`import tailwindcss from '@tailwindcss/vite'`)
  if (hasReact)  imports.push(`import react from '@vitejs/plugin-react'`)
  if (hasVue)    imports.push(`import vue from '@vitejs/plugin-vue'`)
  if (hasSolid)  imports.push(`import solid from 'vike-solid/vite'`)

  const plugins: string[] = ['rudderjs()']
  if (tailwind) plugins.push('tailwindcss()')

  if (hasReact) {
    if (hasReactSolidConflict) {
      if (primary === 'react') {
        plugins.push(`react({ exclude: ['**/pages/solid-demo/**'] })`)
      } else {
        plugins.push(`react({ include: ['**/pages/react-demo/**'] })`)
      }
    } else {
      plugins.push('react()')
    }
  }

  if (hasVue) {
    plugins.push('vue()')
  }

  if (hasSolid) {
    if (hasReactSolidConflict) {
      if (primary === 'solid') {
        plugins.push(`solid({ exclude: ['**/pages/react-demo/**'] })`)
      } else {
        plugins.push(`solid({ include: ['**/pages/solid-demo/**'] })`)
      }
    } else {
      plugins.push('solid()')
    }
  }

  const pluginsStr = plugins.map(p => `    ${p},`).join('\n')

  return `${imports.join('\n')}

export default defineConfig({
  plugins: [
${pluginsStr}
  ],
})
`
}

// ─── +server.ts ───────────────────────────────────────────

function serverTs(): string {
  return `import type { Server } from 'vike/types'
import app from './bootstrap/app.js'

export default {
  fetch: app.fetch,
} satisfies Server
`
}

// ─── prisma.config.ts ──────────────────────────────────────

function prismaConfig(ctx: TemplateContext): string {
  const dbUrl = ctx.db === 'sqlite'
    ? "process.env['DATABASE_URL'] ?? 'file:./dev.db'"
    : "process.env['DATABASE_URL']!"

  return `import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema',
  datasource: {
    url: ${dbUrl},
  },
})
`
}

// ─── .env ──────────────────────────────────────────────────

function dotenv(ctx: TemplateContext): string {
  const lines = [
    `APP_NAME=${ctx.name}`,
    'APP_ENV=development',
    'APP_DEBUG=true',
    'APP_URL=http://localhost:3000',
    '',
    'PORT=3000',
  ]

  if (ctx.orm) {
    lines.push('')
    if (ctx.db === 'sqlite') lines.push('DATABASE_URL="file:./dev.db"')
    else if (ctx.db === 'postgresql') lines.push('DATABASE_URL="postgresql://user:password@localhost:5432/mydb"')
    else lines.push('DATABASE_URL="mysql://user:password@localhost:3306/mydb"')
  }

  if (ctx.packages.auth) {
    lines.push('')
    lines.push(`AUTH_SECRET=${ctx.authSecret}`)
  }

  if (ctx.packages.ai) {
    lines.push('')
    lines.push('AI_MODEL=anthropic/claude-sonnet-4-5')
    lines.push('ANTHROPIC_API_KEY=')
    lines.push('# OPENAI_API_KEY=')
    lines.push('# GOOGLE_AI_API_KEY=')
    lines.push('# OLLAMA_BASE_URL=http://localhost:11434')
  }

  return lines.join('\n') + '\n'
}

// ─── .env.example ──────────────────────────────────────────

function dotenvExample(ctx: TemplateContext): string {
  const lines = [
    `APP_NAME=${ctx.name}`,
    'APP_ENV=development',
    'APP_DEBUG=false',
    'APP_URL=http://localhost:3000',
    '',
    'PORT=3000',
  ]

  if (ctx.orm) {
    lines.push('')
    if (ctx.db === 'sqlite') lines.push('DATABASE_URL="file:./dev.db"')
    else if (ctx.db === 'postgresql') lines.push('DATABASE_URL="postgresql://user:password@localhost:5432/mydb"')
    else lines.push('DATABASE_URL="mysql://user:password@localhost:3306/mydb"')
  }

  if (ctx.packages.auth) {
    lines.push('')
    lines.push('AUTH_SECRET=please-set-a-real-32-char-secret-here')
  }

  if (ctx.packages.ai) {
    lines.push('')
    lines.push('AI_MODEL=anthropic/claude-sonnet-4-5')
    lines.push('ANTHROPIC_API_KEY=')
    lines.push('# OPENAI_API_KEY=')
    lines.push('# GOOGLE_AI_API_KEY=')
    lines.push('# OLLAMA_BASE_URL=http://localhost:11434')
  }

  return lines.join('\n') + '\n'
}

// ─── .gitignore ────────────────────────────────────────────

function gitignore(): string {
  return `node_modules/
dist/
.env
*.db
*.db-journal
prisma/generated/
`
}

function pnpmWorkspace(): string {
  return `# Standalone project — prevents pnpm from merging with a parent workspace\npackages: []\n`
}

// ─── prisma/schema/*.prisma ─────────────────────────────────

function prismaBase(ctx: TemplateContext): string {
  const provider = ctx.db === 'sqlite' ? 'sqlite'
    : ctx.db === 'postgresql' ? 'postgresql'
    : 'mysql'

  return `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
}
`
}

function prismaAuth(): string {
  return `model User {
  id            String    @id @default(cuid())
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  role          String    @default("user")
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  accounts      Account[]
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime
  updatedAt DateTime
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime
  updatedAt             DateTime
}

model Verification {
  id         String    @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime?
  updatedAt  DateTime?
}
`
}

function prismaNotification(): string {
  return `model Notification {
  id              String   @id @default(cuid())
  notifiable_id   String
  notifiable_type String
  type            String
  data            String
  read_at         String?
  created_at      String
  updated_at      String

  @@index([notifiable_type, notifiable_id])
}
`
}

function prismaTodo(): string {
  return `// <rudderjs:modules:start>
// module: Todo (Todo.prisma)
model Todo {
  id        String   @id @default(cuid())
  title     String
  completed Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
// <rudderjs:modules:end>
`
}

// ─── src/index.css ─────────────────────────────────────────

function indexCss(ctx: TemplateContext): string {
  if (!ctx.shadcn) {
    return `@import "tailwindcss";
@import "tw-animate-css";
`
  }

  return `@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
    --radius-sm: calc(var(--radius) - 4px);
    --radius-md: calc(var(--radius) - 2px);
    --radius-lg: var(--radius);
    --radius-xl: calc(var(--radius) + 4px);
    --radius-2xl: calc(var(--radius) + 8px);
    --radius-3xl: calc(var(--radius) + 12px);
    --radius-4xl: calc(var(--radius) + 16px);
    --color-background: var(--background);
    --color-foreground: var(--foreground);
    --color-card: var(--card);
    --color-card-foreground: var(--card-foreground);
    --color-popover: var(--popover);
    --color-popover-foreground: var(--popover-foreground);
    --color-primary: var(--primary);
    --color-primary-foreground: var(--primary-foreground);
    --color-secondary: var(--secondary);
    --color-secondary-foreground: var(--secondary-foreground);
    --color-muted: var(--muted);
    --color-muted-foreground: var(--muted-foreground);
    --color-accent: var(--accent);
    --color-accent-foreground: var(--accent-foreground);
    --color-destructive: var(--destructive);
    --color-border: var(--border);
    --color-input: var(--input);
    --color-ring: var(--ring);
    --color-chart-1: var(--chart-1);
    --color-chart-2: var(--chart-2);
    --color-chart-3: var(--chart-3);
    --color-chart-4: var(--chart-4);
    --color-chart-5: var(--chart-5);
    --color-sidebar: var(--sidebar);
    --color-sidebar-foreground: var(--sidebar-foreground);
    --color-sidebar-primary: var(--sidebar-primary);
    --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
    --color-sidebar-accent: var(--sidebar-accent);
    --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
    --color-sidebar-border: var(--sidebar-border);
    --color-sidebar-ring: var(--sidebar-ring);
}

:root {
    --radius: 0.625rem;
    --background: oklch(1 0 0);
    --foreground: oklch(0.145 0 0);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.145 0 0);
    --popover: oklch(1 0 0);
    --popover-foreground: oklch(0.145 0 0);
    --primary: oklch(0.205 0 0);
    --primary-foreground: oklch(0.985 0 0);
    --secondary: oklch(0.97 0 0);
    --secondary-foreground: oklch(0.205 0 0);
    --muted: oklch(0.97 0 0);
    --muted-foreground: oklch(0.556 0 0);
    --accent: oklch(0.97 0 0);
    --accent-foreground: oklch(0.205 0 0);
    --destructive: oklch(0.577 0.245 27.325);
    --border: oklch(0.922 0 0);
    --input: oklch(0.922 0 0);
    --ring: oklch(0.708 0 0);
    --chart-1: oklch(0.646 0.222 41.116);
    --chart-2: oklch(0.6 0.118 184.704);
    --chart-3: oklch(0.398 0.07 227.392);
    --chart-4: oklch(0.828 0.189 84.429);
    --chart-5: oklch(0.769 0.188 70.08);
    --sidebar: oklch(0.985 0 0);
    --sidebar-foreground: oklch(0.145 0 0);
    --sidebar-primary: oklch(0.205 0 0);
    --sidebar-primary-foreground: oklch(0.985 0 0);
    --sidebar-accent: oklch(0.97 0 0);
    --sidebar-accent-foreground: oklch(0.205 0 0);
    --sidebar-border: oklch(0.922 0 0);
    --sidebar-ring: oklch(0.708 0 0);
}

.dark {
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.205 0 0);
    --card-foreground: oklch(0.985 0 0);
    --popover: oklch(0.205 0 0);
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.922 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --secondary: oklch(0.269 0 0);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.269 0 0);
    --muted-foreground: oklch(0.708 0 0);
    --accent: oklch(0.269 0 0);
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.704 0.191 22.216);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 15%);
    --ring: oklch(0.556 0 0);
    --chart-1: oklch(0.488 0.243 264.376);
    --chart-2: oklch(0.696 0.17 162.48);
    --chart-3: oklch(0.769 0.188 70.08);
    --chart-4: oklch(0.627 0.265 303.9);
    --chart-5: oklch(0.645 0.246 16.439);
    --sidebar: oklch(0.205 0 0);
    --sidebar-foreground: oklch(0.985 0 0);
    --sidebar-primary: oklch(0.488 0.243 264.376);
    --sidebar-primary-foreground: oklch(0.985 0 0);
    --sidebar-accent: oklch(0.269 0 0);
    --sidebar-accent-foreground: oklch(0.985 0 0);
    --sidebar-border: oklch(1 0 0 / 10%);
    --sidebar-ring: oklch(0.556 0 0);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
    }
  body {
    @apply bg-background text-foreground;
    }
}
`
}

// ─── bootstrap/app.ts ──────────────────────────────────────

function bootstrapApp(ctx: TemplateContext): string {
  const imports: string[] = [
    "import 'reflect-metadata'",
    "import 'dotenv/config'",
    "import { Application } from '@rudderjs/core'",
    "import { hono } from '@rudderjs/server-hono'",
    "import { RateLimit, fromClass } from '@rudderjs/middleware'",
  ]
  if (ctx.packages.auth) {
    imports.push("import { sessionMiddleware } from '@rudderjs/session'")
  }
  imports.push("import { RequestIdMiddleware } from '../app/Middleware/RequestIdMiddleware.ts'")
  imports.push("import configs from '../config/index.ts'")
  imports.push("import providers from './providers.ts'")

  const middlewareLines = ['    m.use(RateLimit.perMinute(60))']
  if (ctx.packages.auth) {
    middlewareLines.push('    m.use(sessionMiddleware(configs.session))')
  }
  middlewareLines.push('    m.use(fromClass(RequestIdMiddleware))')

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
${middlewareLines.join('\n')}
  })
  .create()
`
}

// ─── bootstrap/providers.ts ────────────────────────────────

function bootstrapProviders(ctx: TemplateContext): string {
  const imports: string[] = [
    "import type { Application, ServiceProvider } from '@rudderjs/core'",
    "import { events } from '@rudderjs/core'",
    "import { log } from '@rudderjs/log'",
  ]
  const providers: string[] = [
    '// ── Infrastructure (order matters) ──────────────────────',
    'log(configs.log),',
  ]

  if (ctx.orm === 'prisma') {
    imports.push("import { database } from '@rudderjs/orm-prisma'")
    providers.push('database(configs.database),')
  } else if (ctx.orm === 'drizzle') {
    imports.push("import { database } from '@rudderjs/orm-drizzle'")
    providers.push('database(configs.database),')
  }

  if (ctx.packages.auth) {
    imports.push("import { session } from '@rudderjs/session'")
    imports.push("import { hash } from '@rudderjs/hash'")
    providers.push('session(configs.session),')
    providers.push('hash(configs.hash),')
  }
  if (ctx.packages.cache) {
    imports.push("import { cache } from '@rudderjs/cache'")
    providers.push('cache(configs.cache),')
  }
  if (ctx.packages.auth) {
    imports.push("import { auth } from '@rudderjs/auth'")
    providers.push('auth(configs.auth),')
  }

  providers.push('')
  providers.push('// ── Features ────────────────────────────────────────────')
  providers.push('events({}),')

  if (ctx.packages.queue) {
    imports.push("import { queue } from '@rudderjs/queue'")
    providers.push('queue(configs.queue),')
  }
  if (ctx.packages.mail) {
    imports.push("import { mail } from '@rudderjs/mail'")
    providers.push('mail(configs.mail),')
  }
  if (ctx.packages.storage) {
    imports.push("import { storage } from '@rudderjs/storage'")
    providers.push('storage(configs.storage),')
  }
  if (ctx.packages.localization) {
    imports.push("import { resolve } from 'node:path'")
    imports.push("import { localization } from '@rudderjs/localization'")
  }
  if (ctx.packages.scheduler) {
    imports.push("import { scheduler } from '@rudderjs/schedule'")
    providers.push('scheduler(),')
  }
  if (ctx.packages.notifications) {
    imports.push("import { notifications } from '@rudderjs/notification'")
    providers.push('notifications(),')
  }
  if (ctx.packages.broadcast) {
    imports.push("import { broadcasting } from '@rudderjs/broadcast'")
    providers.push('broadcasting(),')
  }
  if (ctx.packages.live) {
    imports.push("import { live } from '@rudderjs/live'")
    providers.push('live({}),')
  }
  if (ctx.packages.localization) {
    providers.push(`localization({
    locale:   'en',
    fallback: 'en',
    path:     resolve(process.cwd(), 'lang'),
  }),`)
  }
  if (ctx.packages.ai) {
    imports.push("import { ai } from '@rudderjs/ai'")
    providers.push('ai(configs.ai),')
  }

  providers.push('')
  providers.push('// ── Application ─────────────────────────────────────────')
  imports.push("import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'")
  providers.push('AppServiceProvider,')

  if (ctx.withTodo) {
    imports.push("import { TodoServiceProvider } from '../app/Modules/Todo/TodoServiceProvider.js'")
    providers.push('TodoServiceProvider,')
  }

  imports.push("import configs from '../config/index.js'")

  return `${imports.join('\n')}

export default [
  ${providers.join('\n  ')}
] satisfies (new (app: Application) => ServiceProvider)[]
`
}

// ─── config files ──────────────────────────────────────────

function configApp(): string {
  return `import { Env } from '@rudderjs/support'

export default {
  name:  Env.get('APP_NAME',  'RudderJS'),
  env:   Env.get('APP_ENV',   'development'),
  debug: Env.getBool('APP_DEBUG', false),
  url:   Env.get('APP_URL', 'http://localhost:3000'),
}
`
}

function configServer(): string {
  return `import { Env } from '@rudderjs/support'

export default {
  port:       Env.getNumber('PORT', 3000),
  trustProxy: Env.getBool('TRUST_PROXY', false),
  cors: {
    origin:  Env.get('CORS_ORIGIN',  '*'),
    methods: Env.get('CORS_METHODS', 'GET,POST,PUT,PATCH,DELETE,OPTIONS'),
    headers: Env.get('CORS_HEADERS', 'Content-Type,Authorization'),
  },
}
`
}

function configLog(): string {
  return `import { Env } from '@rudderjs/support'
import type { LogConfig } from '@rudderjs/log'

export default {
  default: Env.get('LOG_CHANNEL', 'console'),

  channels: {
    stack: {
      driver:           'stack',
      channels:         ['console', 'daily'],
      ignoreExceptions: false,
    },

    console: {
      driver: 'console',
      level:  Env.get('LOG_LEVEL', 'debug') as 'debug',
    },

    single: {
      driver: 'single',
      path:   'storage/logs/rudderjs.log',
      level:  Env.get('LOG_LEVEL', 'debug') as 'debug',
    },

    daily: {
      driver: 'daily',
      path:   'storage/logs/rudderjs.log',
      days:   14,
      level:  Env.get('LOG_LEVEL', 'debug') as 'debug',
    },

    null: {
      driver: 'null',
    },
  },
} satisfies LogConfig
`
}

function configHash(): string {
  return `import { Env } from '@rudderjs/support'
import type { HashConfig } from '@rudderjs/hash'

export default {
  driver: Env.get('HASH_DRIVER', 'bcrypt') as 'bcrypt' | 'argon2',
  bcrypt: { rounds: 12 },
  argon2: { memory: 65536, time: 3, threads: 4 },
} satisfies HashConfig
`
}

function configDatabase(ctx: TemplateContext): string {
  const defaultConn = ctx.db
  const connections: Record<string, string> = {
    sqlite: `    sqlite: {
      driver: 'sqlite' as const,
      url:    Env.get('DATABASE_URL', 'file:./dev.db'),
    },`,
    postgresql: `    postgresql: {
      driver: 'postgresql' as const,
      url:    Env.get('DATABASE_URL', ''),
    },`,
    mysql: `    mysql: {
      driver: 'mysql' as const,
      url:    Env.get('DATABASE_URL', ''),
    },`,
  }

  return `import { Env } from '@rudderjs/support'

export default {
  default: Env.get('DB_CONNECTION', '${defaultConn}'),

  connections: {
${connections[ctx.db]}
  },
}
`
}

function configQueue(): string {
  return `import { Env } from '@rudderjs/support'
import type { QueueConfig } from '@rudderjs/queue'

export default {
  default: Env.get('QUEUE_CONNECTION', 'sync'),

  connections: {
    sync: {
      driver: 'sync',
    },

    inngest: {
      driver:     'inngest',
      appId:      Env.get('INNGEST_APP_ID',      'my-app'),
      eventKey:   Env.get('INNGEST_EVENT_KEY',   ''),
      signingKey: Env.get('INNGEST_SIGNING_KEY',  ''),
      jobs: [],
    },
  },
} satisfies QueueConfig
`
}

function configMail(): string {
  return `import { Env } from '@rudderjs/support'

export default {
  default: Env.get('MAIL_MAILER', 'log'),

  from: {
    address: Env.get('MAIL_FROM_ADDRESS', 'hello@example.com'),
    name:    Env.get('MAIL_FROM_NAME',    'RudderJS'),
  },

  mailers: {
    log: {
      driver: 'log',
    },

    smtp: {
      driver:     'smtp',
      host:       Env.get('MAIL_HOST',     'localhost'),
      port:       Env.getNumber('MAIL_PORT', 587),
      username:   Env.get('MAIL_USERNAME', ''),
      password:   Env.get('MAIL_PASSWORD', ''),
      encryption: Env.get('MAIL_ENCRYPTION', 'tls'),
    },
  },
}
`
}

function configCache(): string {
  return `import { Env } from '@rudderjs/support'
import type { CacheConfig } from '@rudderjs/cache'

export default {
  default: Env.get('CACHE_STORE', 'memory'),

  stores: {
    memory: {
      driver: 'memory',
    },

    redis: {
      driver:   'redis',
      url:      Env.get('REDIS_URL', ''),
      host:     Env.get('REDIS_HOST', '127.0.0.1'),
      port:     Env.getNumber('REDIS_PORT', 6379),
      password: Env.get('REDIS_PASSWORD', ''),
      prefix:   Env.get('CACHE_PREFIX', 'rudderjs:'),
    },
  },
} satisfies CacheConfig
`
}

function configStorage(): string {
  return `import path from 'node:path'
import { Env } from '@rudderjs/support'
import type { StorageConfig } from '@rudderjs/storage'

export default {
  default: Env.get('FILESYSTEM_DISK', 'local'),

  disks: {
    local: {
      driver:  'local',
      root:    path.resolve(process.cwd(), 'storage/app'),
      baseUrl: '/api/files',
    },

    public: {
      driver:  'local',
      root:    path.resolve(process.cwd(), 'storage/app/public'),
      baseUrl: Env.get('APP_URL', 'http://localhost:3000') + '/storage',
    },

    s3: {
      driver:          's3',
      bucket:          Env.get('AWS_BUCKET', ''),
      region:          Env.get('AWS_DEFAULT_REGION', 'us-east-1'),
      accessKeyId:     Env.get('AWS_ACCESS_KEY_ID', ''),
      secretAccessKey: Env.get('AWS_SECRET_ACCESS_KEY', ''),
      endpoint:        Env.get('AWS_ENDPOINT', ''),
      baseUrl:         Env.get('AWS_URL', ''),
    },
  },
} satisfies StorageConfig
`
}

function configAuth(_ctx: TemplateContext): string {
  return `import type { AuthConfig } from '@rudderjs/auth'

export default {
  defaults: { guard: 'web' },
  guards: {
    web: { driver: 'session', provider: 'users' },
  },
  providers: {
    users: { driver: 'eloquent', model: 'User' },
  },
} satisfies AuthConfig
`
}

function configIndex(ctx: TemplateContext): string {
  const imports: string[] = [
    "import app      from './app.js'",
    "import server   from './server.js'",
    "import log      from './log.js'",
  ]
  const keys: string[] = ['app', 'server', 'log']

  if (ctx.orm) {
    imports.push("import database from './database.js'")
    keys.push('database')
  }
  if (ctx.packages.auth) {
    imports.push("import auth     from './auth.js'")
    imports.push("import session  from './session.js'")
    imports.push("import hash     from './hash.js'")
    keys.push('auth', 'session', 'hash')
  }
  if (ctx.packages.queue) {
    imports.push("import queue    from './queue.js'")
    keys.push('queue')
  }
  if (ctx.packages.mail) {
    imports.push("import mail     from './mail.js'")
    keys.push('mail')
  }
  if (ctx.packages.cache) {
    imports.push("import cache    from './cache.js'")
    keys.push('cache')
  }
  if (ctx.packages.storage) {
    imports.push("import storage  from './storage.js'")
    keys.push('storage')
  }
  if (ctx.packages.ai) {
    imports.push("import ai       from './ai.js'")
    keys.push('ai')
  }
  return `${imports.join('\n')}

const configs = { ${keys.join(', ')} }

export type Configs = typeof configs

export default configs
`
}

function envDts(): string {
  return `import type { Configs } from './config/index.js'

declare module '@rudderjs/core' {
  interface AppConfig extends Configs {}
}
`
}

function configSession(): string {
  return `import { Env } from '@rudderjs/support'
import type { SessionConfig } from '@rudderjs/session'

export default {
  driver:   Env.get('SESSION_DRIVER', 'cookie') as 'cookie' | 'redis',
  lifetime: 120,
  secret:   Env.get('SESSION_SECRET', 'change-me-in-production'),
  cookie: {
    name:     'rudderjs_session',
    secure:   Env.getBool('SESSION_SECURE', false),
    httpOnly: true,
    sameSite: 'lax' as const,
    path:     '/',
  },
  redis: { prefix: 'session:', url: Env.get('REDIS_URL', '') },
} satisfies SessionConfig
`
}

function configAi(): string {
  return `import { Env } from '@rudderjs/support'
import type { AiConfig } from '@rudderjs/ai'

export default {
  default: Env.get('AI_MODEL', 'anthropic/claude-sonnet-4-5'),

  providers: {
    anthropic: {
      driver: 'anthropic',
      apiKey: Env.get('ANTHROPIC_API_KEY', ''),
    },

    openai: {
      driver: 'openai',
      apiKey: Env.get('OPENAI_API_KEY', ''),
    },

    google: {
      driver: 'google',
      apiKey: Env.get('GOOGLE_AI_API_KEY', ''),
    },

    ollama: {
      driver:  'ollama',
      baseUrl: Env.get('OLLAMA_BASE_URL', 'http://localhost:11434'),
    },
  },
} satisfies AiConfig
`
}

// ─── app files ─────────────────────────────────────────────

function userModel(): string {
  return `import { Model } from '@rudderjs/orm'

export class User extends Model {
  // Prisma accessor is the model name lowercased
  static table = 'user'

  id!:            string
  name!:          string
  email!:         string
  emailVerified!: boolean
  role!:          string
  createdAt!:     Date
  updatedAt!:     Date
}
`
}

function appServiceProvider(): string {
  return `import { ServiceProvider } from '@rudderjs/core'

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    // Register your application-level services here:
    // this.app.singleton(MyService, () => new MyService())
  }

  boot(): void {
    console.log(\`[AppServiceProvider] booted — \${this.app.name}\`)
  }
}
`
}

function requestIdMiddleware(): string {
  return `import { Middleware } from '@rudderjs/middleware'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

/**
 * Attaches a unique X-Request-Id header to every response.
 * Useful for distributed tracing and log correlation.
 *
 * Registered globally in bootstrap/app.ts via withMiddleware().
 */
export class RequestIdMiddleware extends Middleware {
  async handle(req: AppRequest, res: AppResponse, next: () => Promise<void>): Promise<void> {
    const id = req.headers['x-request-id'] ?? crypto.randomUUID()
    ;(req as unknown as Record<string, unknown>)['requestId'] = id
    await next()
    res.header('X-Request-Id', id)
  }
}
`
}

// ─── routes ────────────────────────────────────────────────

function routesApi(ctx: TemplateContext): string {
  const imports: string[] = [
    "import { router } from '@rudderjs/router'",
  ]
  const lines: string[] = []

  if (ctx.packages.auth || ctx.packages.ai) {
    imports.push("import { app } from '@rudderjs/core'")
  }
  if (ctx.packages.auth) {
    imports.push("import { Auth, AuthManager, runWithAuth, toAuthenticatable } from '@rudderjs/auth'")
    imports.push("import { Hash } from '@rudderjs/hash'")
    imports.push("import { User } from '../app/Models/User.ts'")
    imports.push("import { RateLimit } from '@rudderjs/middleware'")
    lines.push('')
    lines.push("const authLimit = RateLimit.perMinute(10).message('Too many auth attempts. Try again later.')")
  }
  if (ctx.packages.ai) {
    imports.push("import { AI } from '@rudderjs/ai'")
  }

  lines.push('')
  lines.push("router.get('/api/health', (_req, res) => res.json({ status: 'ok' }))")

  if (ctx.packages.auth) {
    lines.push('')
    lines.push(`// GET /api/me — returns current user or null
router.get('/api/me', async (req, res) => {
  const manager = app().make<AuthManager>('auth.manager')
  let user: Record<string, unknown> | null = null
  await runWithAuth(manager, async () => {
    const authUser = await Auth.user()
    if (authUser) {
      user = { id: authUser.getAuthIdentifier() }
    }
  })
  res.json({ user })
})`)
  }

  if (ctx.withTodo) {
    lines.push('')
    lines.push('// Todo routes are registered by TodoServiceProvider — see app/Modules/Todo/TodoServiceProvider.ts')
  }

  if (ctx.packages.auth) {
    lines.push('')
    lines.push(`// POST /api/auth/sign-in/email
router.post('/api/auth/sign-in/email', async (req, res) => {
  const { email, password } = req.body as { email: string; password: string }
  const manager = app().make<AuthManager>('auth.manager')
  let success = false
  await runWithAuth(manager, async () => {
    success = await Auth.attempt({ email, password })
  })
  if (!success) return res.status(401).json({ message: 'Invalid email or password.' })
  res.json({ ok: true })
}, [authLimit])

// POST /api/auth/sign-up/email
router.post('/api/auth/sign-up/email', async (req, res) => {
  const { name, email, password } = req.body as { name: string; email: string; password: string }
  if (!email || !password) return res.status(422).json({ message: 'Email and password are required.' })

  const existing = await User.query().where('email', email).first()
  if (existing) return res.status(422).json({ message: 'An account with this email already exists.' })

  const hashed = await Hash.make(password)
  const user   = await User.create({ name: name ?? '', email, password: hashed })

  const manager = app().make<AuthManager>('auth.manager')
  await runWithAuth(manager, async () => {
    await Auth.login(toAuthenticatable(user as unknown as Record<string, unknown>))
  })
  res.json({ ok: true })
}, [authLimit])

// POST /api/auth/sign-out
router.post('/api/auth/sign-out', async (_req, res) => {
  const manager = app().make<AuthManager>('auth.manager')
  await runWithAuth(manager, async () => { await Auth.logout() })
  res.json({ ok: true })
})

// POST /api/auth/request-password-reset — stub (implement email sending)
router.post('/api/auth/request-password-reset', async (_req, res) => {
  // TODO: integrate @rudderjs/mail to send reset link
  res.json({ ok: true })
}, [authLimit])

// POST /api/auth/reset-password — stub (implement token verification)
router.post('/api/auth/reset-password', async (_req, res) => {
  // TODO: verify token and update password
  res.json({ ok: true })
}, [authLimit])`)
  }

  if (ctx.packages.ai) {
    lines.push('')
    lines.push(`// POST /api/ai/chat — simple AI chat endpoint
router.post('/api/ai/chat', async (req, res) => {
  const { messages } = req.body as { messages: { role: string; content: string }[] }
  const lastMessage  = messages.at(-1)?.content ?? ''
  const response     = await AI.agent('You are a helpful assistant.').prompt(lastMessage)
  res.json({ message: response.text })
})`)
  }

  lines.push('')
  lines.push("// Catch-all: any unmatched /api/* route returns 404")
  lines.push("router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))")

  return imports.join('\n') + '\n' + lines.join('\n') + '\n'
}

function routesWeb(ctx: TemplateContext): string {
  const hasAuth     = ctx.packages.auth
  const hasWelcome  = ctx.frameworks.length === 1

  // ── imports ─────────────────────────────────────────────
  const imports: string[] = [`import { Route } from '@rudderjs/router'`]
  if (hasWelcome) {
    imports.push(`import { createRequire } from 'node:module'`)
    imports.push(`import { view } from '@rudderjs/view'`)
    imports.push(`import { app, config } from '@rudderjs/core'`)
  }
  if (hasAuth) {
    imports.push(`import { SessionMiddleware } from '@rudderjs/session'`)
    imports.push(`import { CsrfMiddleware } from '@rudderjs/middleware'`)
    imports.push(`import { registerAuthRoutes } from '@rudderjs/auth/routes'`)
    if (hasWelcome) {
      imports.push(`import { AuthManager, Auth, runWithAuth } from '@rudderjs/auth'`)
    }
  }

  // ── middleware chain shared with auth routes + welcome ─
  const webMwBlock = hasAuth
    ? `
// Web middleware — session + CSRF apply to web routes (not API)
const webMw = [SessionMiddleware(), CsrfMiddleware()]
`
    : ''

  // ── auth UI wiring ──────────────────────────────────────
  const authBlock = hasAuth
    ? `
// Auth UI routes — login/register/forgot-password/reset-password
// Views live in app/Views/Auth/ (vendored from @rudderjs/auth/views/${ctx.primary}/)
registerAuthRoutes(Route, { middleware: webMw })
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
  // Resolve the current user (if signed in) so the welcome page can show it.
  let user: { name: string; email: string } | null = null
  try {
    const manager = app().make<AuthManager>('auth.manager')
    await runWithAuth(manager, async () => {
      const authUser = await Auth.user()
      if (authUser) {
        const record = authUser as unknown as Record<string, unknown>
        user = {
          name:  String(record['name']  ?? ''),
          email: String(record['email'] ?? ''),
        }
      }
    })
  } catch {
    // auth provider not registered — welcome page just won't show user info
  }` : `
  // Auth is not installed, so the welcome page never shows a signed-in user.
  const user = null`}
  return view('welcome', {
    appName:       config<string>('app.name', 'RudderJS'),
    rudderVersion: rudderCorePkg.version,
    nodeVersion:   process.version.replace(/^v/, ''),
    env:           config<string>('app.env', 'development'),
    user,
  })
}${hasAuth ? ', webMw' : ''})
`
    : ''

  return `${imports.join('\n')}
${webMwBlock}${authBlock}${welcomeBlock}
// Web routes — HTML redirects, guards, and non-API server responses
// These run before Vike's file-based page routing
// Use this file for: redirects, server-side auth guards, download routes, sitemaps, etc.

// Example: redirect root to /todos
// Route.get('/', (_req, res) => res.redirect('/todos'))
`
}

function welcomeExt(fw: 'react' | 'vue' | 'solid'): string {
  return fw === 'vue' ? 'vue' : 'tsx'
}

function routesConsole(): string {
  return `import { rudder } from '@rudderjs/rudder'

rudder.command('inspire', () => {
  const quotes = [
    'The best way to predict the future is to create it.',
    'Build something people want.',
    'Stay hungry, stay foolish.',
    'Code is poetry.',
    'Simplicity is the soul of efficiency.',
  ]
  const quote = quotes[Math.floor(Math.random() * quotes.length)]!
  console.log(\`\\n  "\${quote}"\\n\`)
}).description('Display an inspiring quote')

rudder.command('db:seed', async () => {
  // TODO: add your seed data here
  console.log('No seed data configured. Edit routes/console.ts to add seed logic.')
}).description('Seed the database with sample data')
`
}

// ─── pages ─────────────────────────────────────────────────

function pagesRootConfig(ctx: TemplateContext): string {
  if (ctx.frameworks.length === 1) {
    const rendererImport = ctx.primary === 'vue'
      ? `import vikeVue from 'vike-vue/config'`
      : ctx.primary === 'solid'
        ? `import vikeSolid from 'vike-solid/config'`
        : `import vikeReact from 'vike-react/config'`
    const rendererVar = ctx.primary === 'vue' ? 'vikeVue' : ctx.primary === 'solid' ? 'vikeSolid' : 'vikeReact'
    return `import type { Config } from 'vike/types'
${rendererImport}

export default {
  extends: [${rendererVar}],
} satisfies Config
`
  }

  // Multi-framework: no renderer in root config — each page picks its own
  return `import type { Config } from 'vike/types'

export default {} satisfies Config
`
}

function pagesIndexConfig(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':
      return `import type { Config } from 'vike/types'
import vikeVue from 'vike-vue/config'

export default {
  extends: vikeVue,
} satisfies Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} satisfies Config
`
    default: // react
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} satisfies Config
`
  }
}

function pagesIndexData(ctx: TemplateContext): string {
  if (!ctx.packages.auth) {
    return `export type Data = {
  message: string
}

export async function data(): Promise<Data> {
  return { message: 'Welcome to RudderJS' }
}
`
  }

  return `import { app } from '@rudderjs/core'
import { AuthManager, Auth, runWithAuth } from '@rudderjs/auth'

export type Data = {
  user: { id: string; name: string; email: string } | null
}

export async function data(): Promise<Data> {
  const manager = app().make<AuthManager>('auth.manager')
  let user: Data['user'] = null
  await runWithAuth(manager, async () => {
    const authUser = await Auth.user()
    if (authUser) {
      const record = authUser as unknown as Record<string, unknown>
      user = {
        id:    String(authUser.getAuthIdentifier()),
        name:  String(record['name'] ?? ''),
        email: String(record['email'] ?? ''),
      }
    }
  })
  return { user }
}
`
}

function pagesIndexPage(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':   return pagesIndexPageVue(ctx)
    case 'solid': return pagesIndexPageSolid(ctx)
    default:      return pagesIndexPageReact(ctx)
  }
}

function pagesIndexPageReact(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  const extraLinks: string[] = []
  if (ctx.withTodo) extraLinks.push('        <a href="/todos" className="underline hover:text-foreground">Todos</a>')
  if (ctx.packages.ai) extraLinks.push('        <a href="/ai-chat" className="underline hover:text-foreground">AI Chat</a>')
  const extraLinksStr = extraLinks.length > 0 ? '\n' + extraLinks.join('\n') : ''

  if (!ctx.packages.auth) {
    return `${cssImport}import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'

export default function Page() {
  const data = useData<Data>()

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-4xl font-bold tracking-tight">${ctx.name}</h1>
      <p className="text-muted-foreground">Built with RudderJS — Laravel-inspired Node.js framework.</p>

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <a href="/api/health" className="underline hover:text-foreground">API Health</a>${extraLinksStr}
      </div>
    </div>
  )
}
`
  }

  const todosLink = ctx.withTodo
    ? `          <a href="/todos" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">View Todos</a>`
    : ''

  return `${cssImport}import { useState } from 'react'
import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'

export default function Page() {
  const data         = useData<Data>()
  const [user, setUser] = useState(data.user)

  async function signOut() {
    await fetch('/api/auth/sign-out', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
    })
    window.location.href = '/'
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-4xl font-bold tracking-tight">${ctx.name}</h1>
      <p className="text-muted-foreground">Built with RudderJS — Laravel-inspired Node.js framework.</p>

      {user ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{user.name}</span>
          </p>
          <div className="flex gap-2">
${todosLink}
            <button
              onClick={signOut}
              className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
${todosLink}
          <a href="/register" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Register</a>
          <a href="/login" className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">Login</a>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <a href="/api/health" className="underline hover:text-foreground">API Health</a>
        <a href="/api/me" className="underline hover:text-foreground">Session Info</a>${extraLinksStr}
      </div>
    </div>
  )
}
`
}

function pagesIndexPageVue(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  const extraLinks: string[] = []
  if (ctx.withTodo) extraLinks.push('      <a href="/todos" class="underline hover:text-foreground">Todos</a>')
  if (ctx.packages.ai) extraLinks.push('      <a href="/ai-chat" class="underline hover:text-foreground">AI Chat</a>')
  const extraStr = extraLinks.length > 0 ? '\n' + extraLinks.join('\n') : ''

  if (!ctx.packages.auth) {
    return `<script setup lang="ts">
${cssImport}import { useData } from 'vike-vue/useData'
import type { Data } from './+data.js'

const data = useData<Data>()
</script>

<template>
  <div class="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
    <h1 class="text-4xl font-bold tracking-tight">${ctx.name}</h1>
    <p class="text-muted-foreground">Built with RudderJS — Laravel-inspired Node.js framework.</p>

    <div class="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
      <a href="/api/health" class="underline hover:text-foreground">API Health</a>${extraStr}
    </div>
  </div>
</template>
`
  }

  const todosLink = ctx.withTodo
    ? `\n      <a href="/todos" class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">View Todos</a>`
    : ''

  return `<script setup lang="ts">
${cssImport}import { ref } from 'vue'
import { useData } from 'vike-vue/useData'
import type { Data } from './+data.js'

const data = useData<Data>()
const user = ref(data.user)

async function signOut() {
  await fetch('/api/auth/sign-out', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    '{}',
  })
  window.location.href = '/'
}
</script>

<template>
  <div class="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
    <h1 class="text-4xl font-bold tracking-tight">${ctx.name}</h1>
    <p class="text-muted-foreground">Built with RudderJS — Laravel-inspired Node.js framework.</p>

    <div v-if="user" class="flex flex-col items-center gap-3">
      <p class="text-sm text-muted-foreground">
        Signed in as <span class="font-medium text-foreground">{{ user.name }}</span>
      </p>
      <div class="flex gap-2">${todosLink}
        <button @click="signOut" class="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">
          Sign out
        </button>
      </div>
    </div>
    <div v-else class="flex gap-2">${todosLink}
      <a href="/register" class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Register</a>
      <a href="/login" class="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">Login</a>
    </div>

    <div class="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
      <a href="/api/health" class="underline hover:text-foreground">API Health</a>
      <a href="/api/me" class="underline hover:text-foreground">Session Info</a>${extraStr}
    </div>
  </div>
</template>
`
}

function pagesIndexPageSolid(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  const extraLinks: string[] = []
  if (ctx.withTodo) extraLinks.push('        <a href="/todos" class="underline hover:text-foreground">Todos</a>')
  if (ctx.packages.ai) extraLinks.push('        <a href="/ai-chat" class="underline hover:text-foreground">AI Chat</a>')
  const extraStr = extraLinks.length > 0 ? '\n' + extraLinks.join('\n') : ''

  if (!ctx.packages.auth) {
    return `${cssImport}import { useData } from 'vike-solid/useData'
import type { Data } from './+data.js'

export default function Page() {
  const data = useData<Data>()

  return (
    <div class="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <h1 class="text-4xl font-bold tracking-tight">${ctx.name}</h1>
      <p class="text-muted-foreground">Built with RudderJS — Laravel-inspired Node.js framework.</p>

      <div class="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <a href="/api/health" class="underline hover:text-foreground">API Health</a>${extraStr}
      </div>
    </div>
  )
}
`
  }

  const todosLink = ctx.withTodo
    ? `\n        <a href="/todos" class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">View Todos</a>`
    : ''

  return `${cssImport}import { createSignal } from 'solid-js'
import { useData } from 'vike-solid/useData'
import type { Data } from './+data.js'

export default function Page() {
  const data = useData<Data>()
  const [user, setUser] = createSignal(data.user)

  async function signOut() {
    await fetch('/api/auth/sign-out', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
    })
    window.location.href = '/'
  }

  return (
    <div class="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <h1 class="text-4xl font-bold tracking-tight">${ctx.name}</h1>
      <p class="text-muted-foreground">Built with RudderJS — Laravel-inspired Node.js framework.</p>

      {user() ? (
        <div class="flex flex-col items-center gap-3">
          <p class="text-sm text-muted-foreground">
            Signed in as <span class="font-medium text-foreground">{user()!.name}</span>
          </p>
          <div class="flex gap-2">${todosLink}
            <button
              onClick={signOut}
              class="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <div class="flex gap-2">${todosLink}
          <a href="/register" class="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Register</a>
          <a href="/login" class="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">Login</a>
        </div>
      )}

      <div class="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        <a href="/api/health" class="underline hover:text-foreground">API Health</a>
        <a href="/api/me" class="underline hover:text-foreground">Session Info</a>${extraStr}
      </div>
    </div>
  )
}
`
}

// ─── welcome view (controller-returned) ─────────────────────

function welcomeView(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':   return welcomeViewVue()
    case 'solid': return welcomeViewSolid()
    default:      return welcomeViewReact()
  }
}

const WELCOME_FEATURES = `const DEFAULT_DOCS   = 'https://github.com/rudderjs/rudder'
const DEFAULT_GITHUB = 'https://github.com/rudderjs/rudder'

const features: Feature[] = [
  {
    title:       'Controllers & Routing',
    description: 'Explicit routes in routes/api.ts with middleware, params, named routes, and return types that just work.',
    href:        \`\${DEFAULT_DOCS}#routing\`,
  },
  {
    title:       'Eloquent ORM',
    description: 'Laravel-style models on Prisma or Drizzle. Query relationships, scopes, and eager loading without changing mental models.',
    href:        \`\${DEFAULT_DOCS}#orm\`,
  },
  {
    title:       'Controller Views',
    description: "The page you're looking at — return view() from a controller, rendered through Vike SSR. Zero adapter, full SPA nav.",
    href:        \`\${DEFAULT_DOCS}#views\`,
  },
  {
    title:       'Rudder CLI',
    description: 'Laravel-style make:* generators, schedule, db:seed, and custom commands. Run \\\`pnpm rudder\\\` for the full list.',
    href:        \`\${DEFAULT_DOCS}#cli\`,
  },
  {
    title:       'Queues & Jobs',
    description: 'Dispatch background jobs with sync, database, or Redis drivers. Monitor them with @rudderjs/horizon.',
    href:        \`\${DEFAULT_DOCS}#queue\`,
  },
  {
    title:       'Auth, Guards, Policies',
    description: 'Session-backed auth, password reset, gates, and RequireAuth / RequireGuest middleware — all through one provider.',
    href:        \`\${DEFAULT_DOCS}#auth\`,
  },
]`

function welcomeViewReact(): string {
  return `import '@/index.css'

// URL this view is served at — MUST match the Route.get('/', ...) in routes/web.ts.
// The scanner reads this constant and writes it into the generated +route.ts,
// so Vike's client router can SPA-navigate here instead of doing full reloads.
export const route = '/'

export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
  user:          { name: string; email: string } | null
  loginUrl?:     string
  registerUrl?:  string
  signOutUrl?:   string
  docsUrl?:      string
  githubUrl?:    string
}

interface Feature {
  title:       string
  description: string
  href:        string
}

${WELCOME_FEATURES}

export default function Welcome(props: WelcomeProps) {
  const loginUrl    = props.loginUrl    ?? '/login'
  const registerUrl = props.registerUrl ?? '/register'
  const signOutUrl  = props.signOutUrl  ?? '/api/auth/sign-out'
  const docsUrl     = props.docsUrl     ?? DEFAULT_DOCS
  const githubUrl   = props.githubUrl   ?? DEFAULT_GITHUB

  async function handleSignOut() {
    await fetch(signOutUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
    })
    // Full reload so the server resolves a fresh pageContext (logged-out user).
    window.location.href = '/'
  }

  return (
    <div className="min-h-svh bg-gradient-to-b from-white to-zinc-50 text-zinc-900 dark:from-zinc-950 dark:to-black dark:text-zinc-100">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          RudderJS
        </div>
        <div className="flex items-center gap-4 text-sm">
          {props.user ? (
            <>
              <span className="text-zinc-500 dark:text-zinc-400">
                Signed in as{' '}
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{props.user.name}</span>
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <a href={loginUrl} className="text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">Log in</a>
              <a href={registerUrl} className="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">Register</a>
            </>
          )}
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-6 pb-12 pt-20 text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">{props.appName}</h1>
        <p className="mt-6 text-lg text-zinc-600 dark:text-zinc-400">
          Laravel&apos;s developer experience, Vike&apos;s performance, Node&apos;s ecosystem.
          <br className="hidden sm:block" />
          This page is served by a controller, rendered through{' '}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-900">view(&apos;welcome&apos;)</code>.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3 text-xs text-zinc-500">
          <span>RudderJS v{props.rudderVersion}</span>
          <span>•</span>
          <span>Node {props.nodeVersion}</span>
          <span>•</span>
          <span>env={props.env}</span>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map(f => (
            <a
              key={f.title}
              href={f.href}
              className="group rounded-xl border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-100"
            >
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-zinc-600 group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-100">
                {f.description}
              </p>
            </a>
          ))}
        </div>
      </section>

      <footer className="border-t border-zinc-200 dark:border-zinc-900">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-6 text-xs text-zinc-500 sm:flex-row sm:justify-between">
          <div>Built with RudderJS. Edit <code>app/Views/Welcome.tsx</code> to customize this page.</div>
          <div className="flex gap-4">
            <a href={docsUrl} className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">Docs</a>
            <a href={githubUrl} className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
`
}

function welcomeViewVue(): string {
  return `<script setup lang="ts">
import '@/index.css'

// URL this view is served at — see the React variant for rationale.
export const route = '/'

export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
  user:          { name: string; email: string } | null
  loginUrl?:     string
  registerUrl?:  string
  signOutUrl?:   string
  docsUrl?:      string
  githubUrl?:    string
}

const props = defineProps<WelcomeProps>()

interface Feature {
  title:       string
  description: string
  href:        string
}

${WELCOME_FEATURES}

const loginUrl    = props.loginUrl    ?? '/login'
const registerUrl = props.registerUrl ?? '/register'
const signOutUrl  = props.signOutUrl  ?? '/api/auth/sign-out'
const docsUrl     = props.docsUrl     ?? DEFAULT_DOCS
const githubUrl   = props.githubUrl   ?? DEFAULT_GITHUB

async function handleSignOut() {
  await fetch(signOutUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    '{}',
  })
  // Full reload so the server resolves a fresh pageContext (logged-out user).
  window.location.href = '/'
}
</script>

<template>
  <div class="min-h-svh bg-gradient-to-b from-white to-zinc-50 text-zinc-900 dark:from-zinc-950 dark:to-black dark:text-zinc-100">
    <nav class="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <div class="flex items-center gap-2 text-sm font-semibold tracking-tight">
        <span class="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
        RudderJS
      </div>
      <div class="flex items-center gap-4 text-sm">
        <template v-if="props.user">
          <span class="text-zinc-500 dark:text-zinc-400">
            Signed in as
            <span class="font-medium text-zinc-900 dark:text-zinc-100">{{ props.user.name }}</span>
          </span>
          <button
            type="button"
            @click="handleSignOut"
            class="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Sign out
          </button>
        </template>
        <template v-else>
          <a :href="loginUrl" class="text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">Log in</a>
          <a :href="registerUrl" class="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">Register</a>
        </template>
      </div>
    </nav>

    <section class="mx-auto max-w-3xl px-6 pb-12 pt-20 text-center">
      <h1 class="text-5xl font-bold tracking-tight sm:text-6xl">{{ props.appName }}</h1>
      <p class="mt-6 text-lg text-zinc-600 dark:text-zinc-400">
        Laravel's developer experience, Vike's performance, Node's ecosystem.
        <br class="hidden sm:block" />
        This page is served by a controller, rendered through
        <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-900">view('welcome')</code>.
      </p>
      <div class="mt-8 flex items-center justify-center gap-3 text-xs text-zinc-500">
        <span>RudderJS v{{ props.rudderVersion }}</span>
        <span>•</span>
        <span>Node {{ props.nodeVersion }}</span>
        <span>•</span>
        <span>env={{ props.env }}</span>
      </div>
    </section>

    <section class="mx-auto max-w-6xl px-6 pb-20">
      <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <a
          v-for="f in features"
          :key="f.title"
          :href="f.href"
          class="group rounded-xl border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-100"
        >
          <h3 class="font-semibold">{{ f.title }}</h3>
          <p class="mt-2 text-sm text-zinc-600 group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-100">
            {{ f.description }}
          </p>
        </a>
      </div>
    </section>

    <footer class="border-t border-zinc-200 dark:border-zinc-900">
      <div class="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-6 text-xs text-zinc-500 sm:flex-row sm:justify-between">
        <div>Built with RudderJS. Edit <code>app/Views/Welcome.vue</code> to customize this page.</div>
        <div class="flex gap-4">
          <a :href="docsUrl" class="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">Docs</a>
          <a :href="githubUrl" class="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">GitHub</a>
        </div>
      </div>
    </footer>
  </div>
</template>
`
}

function welcomeViewSolid(): string {
  return `import '@/index.css'
import { For, Show } from 'solid-js'

// URL this view is served at — see the React variant for rationale.
export const route = '/'

export interface WelcomeProps {
  appName:       string
  rudderVersion: string
  nodeVersion:   string
  env:           string
  user:          { name: string; email: string } | null
  loginUrl?:     string
  registerUrl?:  string
  signOutUrl?:   string
  docsUrl?:      string
  githubUrl?:    string
}

interface Feature {
  title:       string
  description: string
  href:        string
}

${WELCOME_FEATURES}

export default function Welcome(props: WelcomeProps) {
  const loginUrl    = () => props.loginUrl    ?? '/login'
  const registerUrl = () => props.registerUrl ?? '/register'
  const signOutUrl  = () => props.signOutUrl  ?? '/api/auth/sign-out'
  const docsUrl     = () => props.docsUrl     ?? DEFAULT_DOCS
  const githubUrl   = () => props.githubUrl   ?? DEFAULT_GITHUB

  async function handleSignOut() {
    await fetch(signOutUrl(), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
    })
    // Full reload so the server resolves a fresh pageContext (logged-out user).
    window.location.href = '/'
  }

  return (
    <div class="min-h-svh bg-gradient-to-b from-white to-zinc-50 text-zinc-900 dark:from-zinc-950 dark:to-black dark:text-zinc-100">
      <nav class="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div class="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span class="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          RudderJS
        </div>
        <div class="flex items-center gap-4 text-sm">
          <Show
            when={props.user}
            fallback={
              <>
                <a href={loginUrl()} class="text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">Log in</a>
                <a href={registerUrl()} class="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900">Register</a>
              </>
            }
          >
            {(user) => (
              <>
                <span class="text-zinc-500 dark:text-zinc-400">
                  Signed in as <span class="font-medium text-zinc-900 dark:text-zinc-100">{user().name}</span>
                </span>
                <button
                  type="button"
                  onClick={handleSignOut}
                  class="rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Sign out
                </button>
              </>
            )}
          </Show>
        </div>
      </nav>

      <section class="mx-auto max-w-3xl px-6 pb-12 pt-20 text-center">
        <h1 class="text-5xl font-bold tracking-tight sm:text-6xl">{props.appName}</h1>
        <p class="mt-6 text-lg text-zinc-600 dark:text-zinc-400">
          Laravel's developer experience, Vike's performance, Node's ecosystem.
          <br class="hidden sm:block" />
          This page is served by a controller, rendered through{' '}
          <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-sm dark:bg-zinc-900">view('welcome')</code>.
        </p>
        <div class="mt-8 flex items-center justify-center gap-3 text-xs text-zinc-500">
          <span>RudderJS v{props.rudderVersion}</span>
          <span>•</span>
          <span>Node {props.nodeVersion}</span>
          <span>•</span>
          <span>env={props.env}</span>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-6 pb-20">
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <For each={features}>
            {(f) => (
              <a
                href={f.href}
                class="group rounded-xl border border-zinc-200 bg-white p-6 transition-colors hover:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-100"
              >
                <h3 class="font-semibold">{f.title}</h3>
                <p class="mt-2 text-sm text-zinc-600 group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-100">
                  {f.description}
                </p>
              </a>
            )}
          </For>
        </div>
      </section>

      <footer class="border-t border-zinc-200 dark:border-zinc-900">
        <div class="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-6 text-xs text-zinc-500 sm:flex-row sm:justify-between">
          <div>Built with RudderJS. Edit <code>app/Views/Welcome.tsx</code> to customize this page.</div>
          <div class="flex gap-4">
            <a href={docsUrl()} class="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">Docs</a>
            <a href={githubUrl()} class="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
`
}

function pagesErrorConfig(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':
      return `import type { Config } from 'vike/types'
import vikeVue from 'vike-vue/config'

export default {
  extends: vikeVue,
} satisfies Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} satisfies Config
`
    default:
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} satisfies Config
`
  }
}

function pagesErrorPage(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':   return pagesErrorPageVue(ctx)
    case 'solid': return pagesErrorPageSolid(ctx)
    default:      return pagesErrorPageReact(ctx)
  }
}

function pagesErrorPageReact(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  return `${cssImport}import { usePageContext } from 'vike-react/usePageContext'

export default function Page() {
  const { is404, abortReason, abortStatusCode } = usePageContext() as {
    is404: boolean
    abortStatusCode?: number
    abortReason?: string
  }

  if (is404) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-2">
        <h1 className="text-2xl font-bold">404 — Page Not Found</h1>
        <p className="text-muted-foreground">This page could not be found.</p>
        <a href="/" className="mt-4 text-sm underline">Go home</a>
      </div>
    )
  }

  if (abortStatusCode === 401) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-2">
        <h1 className="text-2xl font-bold">401 — Unauthorized</h1>
        <p className="text-muted-foreground">{abortReason ?? 'You must be logged in to view this page.'}</p>
        <a href="/" className="mt-4 text-sm underline">Go home</a>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-2">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground">{abortReason ?? 'An unexpected error occurred.'}</p>
      <a href="/" className="mt-4 text-sm underline">Go home</a>
    </div>
  )
}
`
}

function pagesErrorPageVue(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  return `<script setup lang="ts">
${cssImport}import { usePageContext } from 'vike-vue/usePageContext'

const pageContext = usePageContext() as {
  is404: boolean
  abortStatusCode?: number
  abortReason?: string
}
</script>

<template>
  <div v-if="pageContext.is404" class="flex min-h-svh flex-col items-center justify-center gap-2">
    <h1 class="text-2xl font-bold">404 — Page Not Found</h1>
    <p class="text-muted-foreground">This page could not be found.</p>
    <a href="/" class="mt-4 text-sm underline">Go home</a>
  </div>
  <div v-else-if="pageContext.abortStatusCode === 401" class="flex min-h-svh flex-col items-center justify-center gap-2">
    <h1 class="text-2xl font-bold">401 — Unauthorized</h1>
    <p class="text-muted-foreground">{{ pageContext.abortReason ?? 'You must be logged in to view this page.' }}</p>
    <a href="/" class="mt-4 text-sm underline">Go home</a>
  </div>
  <div v-else class="flex min-h-svh flex-col items-center justify-center gap-2">
    <h1 class="text-2xl font-bold">Something went wrong</h1>
    <p class="text-muted-foreground">{{ pageContext.abortReason ?? 'An unexpected error occurred.' }}</p>
    <a href="/" class="mt-4 text-sm underline">Go home</a>
  </div>
</template>
`
}

function pagesErrorPageSolid(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  return `${cssImport}import { Switch, Match } from 'solid-js'
import { usePageContext } from 'vike-solid/usePageContext'

export default function Page() {
  const pageContext = usePageContext() as {
    is404: boolean
    abortStatusCode?: number
    abortReason?: string
  }

  return (
    <Switch>
      <Match when={pageContext.is404}>
        <div class="flex min-h-svh flex-col items-center justify-center gap-2">
          <h1 class="text-2xl font-bold">404 — Page Not Found</h1>
          <p class="text-muted-foreground">This page could not be found.</p>
          <a href="/" class="mt-4 text-sm underline">Go home</a>
        </div>
      </Match>
      <Match when={pageContext.abortStatusCode === 401}>
        <div class="flex min-h-svh flex-col items-center justify-center gap-2">
          <h1 class="text-2xl font-bold">401 — Unauthorized</h1>
          <p class="text-muted-foreground">{pageContext.abortReason ?? 'You must be logged in to view this page.'}</p>
          <a href="/" class="mt-4 text-sm underline">Go home</a>
        </div>
      </Match>
      <Match when={true}>
        <div class="flex min-h-svh flex-col items-center justify-center gap-2">
          <h1 class="text-2xl font-bold">Something went wrong</h1>
          <p class="text-muted-foreground">{pageContext.abortReason ?? 'An unexpected error occurred.'}</p>
          <a href="/" class="mt-4 text-sm underline">Go home</a>
        </div>
      </Match>
    </Switch>
  )
}
`
}

// ─── Todo module ───────────────────────────────────────────

function todoSchema(): string {
  return `import { z } from 'zod'

export const TodoInputSchema = z.object({
  title:     z.string().min(1, 'Title is required'),
  completed: z.boolean().optional().default(false),
})

export const TodoUpdateSchema = z.object({
  title:     z.string().min(1).optional(),
  completed: z.boolean().optional(),
})

export type TodoInput  = z.infer<typeof TodoInputSchema>
export type TodoUpdate = z.infer<typeof TodoUpdateSchema>

export interface Todo {
  id:        string
  title:     string
  completed: boolean
  createdAt: Date
  updatedAt: Date
}
`
}

function todoService(): string {
  return `import { Injectable } from '@rudderjs/core'
import { resolve } from '@rudderjs/core'
import type { OrmAdapter } from '@rudderjs/orm'
import type { Todo, TodoInput, TodoUpdate } from './TodoSchema.js'

@Injectable()
export class TodoService {
  private get db(): OrmAdapter { return resolve<OrmAdapter>('db') }

  findAll(): Promise<Todo[]> {
    return this.db.query<Todo>('todo').orderBy('createdAt', 'DESC').get()
  }

  findById(id: string): Promise<Todo | null> {
    return this.db.query<Todo>('todo').find(id)
  }

  create(input: TodoInput): Promise<Todo> {
    return this.db.query<Todo>('todo').create(input as Partial<Todo>)
  }

  update(id: string, input: TodoUpdate): Promise<Todo> {
    return this.db.query<Todo>('todo').update(id, input as Partial<Todo>)
  }

  delete(id: string): Promise<void> {
    return this.db.query<Todo>('todo').delete(id)
  }
}
`
}

function todoServiceProvider(): string {
  return `import { ServiceProvider } from '@rudderjs/core'
import { router } from '@rudderjs/router'
import { TodoService } from './TodoService.js'
import { TodoInputSchema, TodoUpdateSchema } from './TodoSchema.js'

export class TodoServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(TodoService, () => new TodoService())
  }

  override async boot(): Promise<void> {
    const service = this.app.make<TodoService>(TodoService)

    router.get('/api/todos', async (_req, res) => {
      const todos = await service.findAll()
      res.json({ data: todos })
    })

    router.post('/api/todos', async (req, res) => {
      const parsed = TodoInputSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(422).json({ errors: parsed.error.flatten().fieldErrors })
        return
      }
      const todo = await service.create(parsed.data)
      res.status(201).json({ data: todo })
    })

    router.patch('/api/todos/:id', async (req, res) => {
      const parsed = TodoUpdateSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(422).json({ errors: parsed.error.flatten().fieldErrors })
        return
      }
      const todo = await service.update(req.params['id']!, parsed.data)
      res.json({ data: todo })
    })

    router.delete('/api/todos/:id', async (req, res) => {
      await service.delete(req.params['id']!)
      res.status(204).send('')
    })
  }
}
`
}

function todoPageConfig(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':
      return `import type { Config } from 'vike/types'
import vikeVue from 'vike-vue/config'

export default {
  extends: vikeVue,
} satisfies Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} satisfies Config
`
    default:
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} satisfies Config
`
  }
}

function todoPageData(): string {
  return `import { resolve } from '@rudderjs/core'
import { TodoService } from '../../app/Modules/Todo/TodoService.js'
import type { Todo } from '../../app/Modules/Todo/TodoSchema.js'

export type Data = { todos: Todo[] }

export async function data(): Promise<Data> {
  const service = resolve<TodoService>(TodoService)
  const todos   = await service.findAll()
  return { todos }
}
`
}

function todoPage(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':   return todoPageVue(ctx)
    case 'solid': return todoPageSolid(ctx)
    default:      return todoPageReact(ctx)
  }
}

function todoPageReact(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  return `${cssImport}import { useState } from 'react'
import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'
import type { Todo } from '../../app/Modules/Todo/TodoSchema.js'

export default function Page() {
  const data            = useData<Data>()
  const [todos, setTodos] = useState<Todo[]>(data.todos)
  const [input, setInput] = useState('')

  async function addTodo(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    const res  = await fetch('/api/todos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title: input }),
    })
    const json = await res.json() as { data: Todo }
    setTodos([json.data, ...todos])
    setInput('')
  }

  async function toggleTodo(id: string, completed: boolean) {
    await fetch(\`/api/todos/\${id}\`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ completed: !completed }),
    })
    setTodos(todos.map(t => t.id === id ? { ...t, completed: !completed } : t))
  }

  async function deleteTodo(id: string) {
    await fetch(\`/api/todos/\${id}\`, { method: 'DELETE' })
    setTodos(todos.filter(t => t.id !== id))
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-3xl font-bold">Todos</h1>

      <form onSubmit={addTodo} className="flex w-full max-w-md gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Add a new todo..."
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add
        </button>
      </form>

      <ul className="w-full max-w-md space-y-2">
        {todos.map(todo => (
          <li key={todo.id} className="flex items-center gap-3 rounded-lg border p-3">
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => toggleTodo(todo.id, todo.completed)}
              className="h-4 w-4 cursor-pointer"
            />
            <span className={\`flex-1 text-sm \${todo.completed ? 'line-through text-muted-foreground' : ''}\`}>
              {todo.title}
            </span>
            <button
              onClick={() => deleteTodo(todo.id)}
              className="text-xs text-destructive hover:underline"
            >
              Delete
            </button>
          </li>
        ))}
        {todos.length === 0 && (
          <li className="py-8 text-center text-sm text-muted-foreground">
            No todos yet. Add one above!
          </li>
        )}
      </ul>

      <a href="/" className="text-sm text-muted-foreground underline hover:text-foreground">
        ← Back to home
      </a>
    </div>
  )
}
`
}

function todoPageVue(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  return `<script setup lang="ts">
${cssImport}import { ref } from 'vue'
import { useData } from 'vike-vue/useData'
import type { Data } from './+data.js'
import type { Todo } from '../../app/Modules/Todo/TodoSchema.js'

const data  = useData<Data>()
const todos = ref<Todo[]>(data.todos)
const input = ref('')

async function addTodo(e: Event) {
  e.preventDefault()
  if (!input.value.trim()) return
  const res  = await fetch('/api/todos', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ title: input.value }),
  })
  const json = await res.json() as { data: Todo }
  todos.value = [json.data, ...todos.value]
  input.value = ''
}

async function toggleTodo(id: string, completed: boolean) {
  await fetch(\`/api/todos/\${id}\`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ completed: !completed }),
  })
  todos.value = todos.value.map(t => t.id === id ? { ...t, completed: !completed } : t)
}

async function deleteTodo(id: string) {
  await fetch(\`/api/todos/\${id}\`, { method: 'DELETE' })
  todos.value = todos.value.filter(t => t.id !== id)
}
</script>

<template>
  <div class="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
    <h1 class="text-3xl font-bold">Todos</h1>

    <form @submit="addTodo" class="flex w-full max-w-md gap-2">
      <input
        v-model="input"
        placeholder="Add a new todo..."
        class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="submit"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Add
      </button>
    </form>

    <ul class="w-full max-w-md space-y-2">
      <li v-for="todo in todos" :key="todo.id" class="flex items-center gap-3 rounded-lg border p-3">
        <input
          type="checkbox"
          :checked="todo.completed"
          @change="toggleTodo(todo.id, todo.completed)"
          class="h-4 w-4 cursor-pointer"
        />
        <span :class="['flex-1 text-sm', todo.completed ? 'line-through text-muted-foreground' : '']">
          {{ todo.title }}
        </span>
        <button @click="deleteTodo(todo.id)" class="text-xs text-destructive hover:underline">
          Delete
        </button>
      </li>
      <li v-if="todos.length === 0" class="py-8 text-center text-sm text-muted-foreground">
        No todos yet. Add one above!
      </li>
    </ul>

    <a href="/" class="text-sm text-muted-foreground underline hover:text-foreground">
      ← Back to home
    </a>
  </div>
</template>
`
}

function todoPageSolid(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  return `${cssImport}import { createSignal } from 'solid-js'
import { For, Show } from 'solid-js'
import { useData } from 'vike-solid/useData'
import type { Data } from './+data.js'
import type { Todo } from '../../app/Modules/Todo/TodoSchema.js'

export default function Page() {
  const data = useData<Data>()
  const [todos, setTodos] = createSignal<Todo[]>(data.todos)
  const [input, setInput] = createSignal('')

  async function addTodo(e: Event) {
    e.preventDefault()
    if (!input().trim()) return
    const res  = await fetch('/api/todos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title: input() }),
    })
    const json = await res.json() as { data: Todo }
    setTodos([json.data, ...todos()])
    setInput('')
  }

  async function toggleTodo(id: string, completed: boolean) {
    await fetch(\`/api/todos/\${id}\`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ completed: !completed }),
    })
    setTodos(todos().map(t => t.id === id ? { ...t, completed: !completed } : t))
  }

  async function deleteTodo(id: string) {
    await fetch(\`/api/todos/\${id}\`, { method: 'DELETE' })
    setTodos(todos().filter(t => t.id !== id))
  }

  return (
    <div class="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <h1 class="text-3xl font-bold">Todos</h1>

      <form onSubmit={addTodo} class="flex w-full max-w-md gap-2">
        <input
          value={input()}
          onInput={e => setInput(e.currentTarget.value)}
          placeholder="Add a new todo..."
          class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add
        </button>
      </form>

      <ul class="w-full max-w-md space-y-2">
        <For each={todos()} fallback={
          <li class="py-8 text-center text-sm text-muted-foreground">No todos yet. Add one above!</li>
        }>
          {(todo) => (
            <li class="flex items-center gap-3 rounded-lg border p-3">
              <input
                type="checkbox"
                checked={todo.completed}
                onChange={() => toggleTodo(todo.id, todo.completed)}
                class="h-4 w-4 cursor-pointer"
              />
              <span class={\`flex-1 text-sm \${todo.completed ? 'line-through text-muted-foreground' : ''}\`}>
                {todo.title}
              </span>
              <button onClick={() => deleteTodo(todo.id)} class="text-xs text-destructive hover:underline">
                Delete
              </button>
            </li>
          )}
        </For>
      </ul>

      <a href="/" class="text-sm text-muted-foreground underline hover:text-foreground">
        ← Back to home
      </a>
    </div>
  )
}
`
}

// ─── AI chat page ─────────────────────────────────────────

function aiChatPageConfig(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':
      return `import type { Config } from 'vike/types'
import vikeVue from 'vike-vue/config'

export default {
  extends: vikeVue,
} satisfies Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} satisfies Config
`
    default:
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} satisfies Config
`
  }
}

function aiChatPage(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':   return aiChatPageVue(ctx)
    case 'solid': return aiChatPageSolid(ctx)
    default:      return aiChatPageReact(ctx)
  }
}

function aiChatPageReact(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  return `${cssImport}import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [messages])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || loading) return

    const userMsg: Message = { role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: [...messages, userMsg] }),
      })
      const json = await res.json() as { message: string }
      setMessages(prev => [...prev, { role: 'assistant', content: json.message }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Check your AI_PROVIDER and API key in .env.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center p-4">
      <div className="flex w-full max-w-2xl flex-1 flex-col">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">AI Chat</h1>
          <a href="/" className="text-sm text-muted-foreground underline hover:text-foreground">← Home</a>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded-lg border p-4" style={{ maxHeight: 'calc(100svh - 180px)' }}>
          {messages.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">Send a message to start chatting.</p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={\`flex \${msg.role === 'user' ? 'justify-end' : 'justify-start'}\`}>
              <div className={\`max-w-[80%] rounded-lg px-3 py-2 text-sm \${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }\`}>
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Thinking...</div>
            </div>
          )}
        </div>

        <form onSubmit={send} className="mt-3 flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={loading}
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
`
}

function aiChatPageVue(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  return `<script setup lang="ts">
${cssImport}import { ref, nextTick } from 'vue'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const messages  = ref<Message[]>([])
const input     = ref('')
const loading   = ref(false)
const scrollEl  = ref<HTMLDivElement>()

async function send(e: Event) {
  e.preventDefault()
  if (!input.value.trim() || loading.value) return

  const userMsg: Message = { role: 'user', content: input.value }
  messages.value.push(userMsg)
  input.value = ''
  loading.value = true

  try {
    const res = await fetch('/api/ai/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: messages.value }),
    })
    const json = await res.json() as { message: string }
    messages.value.push({ role: 'assistant', content: json.message })
  } catch {
    messages.value.push({ role: 'assistant', content: 'Something went wrong. Check your AI_PROVIDER and API key in .env.' })
  } finally {
    loading.value = false
    await nextTick()
    scrollEl.value?.scrollTo(0, scrollEl.value.scrollHeight)
  }
}
</script>

<template>
  <div class="flex min-h-svh flex-col items-center p-4">
    <div class="flex w-full max-w-2xl flex-1 flex-col">
      <div class="mb-4 flex items-center justify-between">
        <h1 class="text-2xl font-bold">AI Chat</h1>
        <a href="/" class="text-sm text-muted-foreground underline hover:text-foreground">← Home</a>
      </div>

      <div ref="scrollEl" class="flex-1 space-y-3 overflow-y-auto rounded-lg border p-4" :style="{ maxHeight: 'calc(100svh - 180px)' }">
        <p v-if="messages.length === 0" class="py-12 text-center text-sm text-muted-foreground">Send a message to start chatting.</p>
        <div v-for="(msg, i) in messages" :key="i" :class="['flex', msg.role === 'user' ? 'justify-end' : 'justify-start']">
          <div :class="['max-w-[80%] rounded-lg px-3 py-2 text-sm', msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground']">
            {{ msg.content }}
          </div>
        </div>
        <div v-if="loading" class="flex justify-start">
          <div class="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Thinking...</div>
        </div>
      </div>

      <form @submit="send" class="mt-3 flex gap-2">
        <input
          v-model="input"
          placeholder="Type a message..."
          :disabled="loading"
          class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <button
          type="submit"
          :disabled="loading"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  </div>
</template>
`
}

function aiChatPageSolid(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
  return `${cssImport}import { createSignal, For, Show, onCleanup } from 'solid-js'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function Page() {
  const [messages, setMessages] = createSignal<Message[]>([])
  const [input, setInput]       = createSignal('')
  const [loading, setLoading]   = createSignal(false)
  let scrollEl: HTMLDivElement | undefined

  function scrollToBottom() {
    setTimeout(() => scrollEl?.scrollTo(0, scrollEl.scrollHeight), 0)
  }

  async function send(e: Event) {
    e.preventDefault()
    if (!input().trim() || loading()) return

    const userMsg: Message = { role: 'user', content: input() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    scrollToBottom()

    try {
      const res = await fetch('/api/ai/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: [...messages()] }),
      })
      const json = await res.json() as { message: string }
      setMessages(prev => [...prev, { role: 'assistant', content: json.message }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Check your AI_PROVIDER and API key in .env.' }])
    } finally {
      setLoading(false)
      scrollToBottom()
    }
  }

  return (
    <div class="flex min-h-svh flex-col items-center p-4">
      <div class="flex w-full max-w-2xl flex-1 flex-col">
        <div class="mb-4 flex items-center justify-between">
          <h1 class="text-2xl font-bold">AI Chat</h1>
          <a href="/" class="text-sm text-muted-foreground underline hover:text-foreground">← Home</a>
        </div>

        <div ref={scrollEl} class="flex-1 space-y-3 overflow-y-auto rounded-lg border p-4" style={{ "max-height": 'calc(100svh - 180px)' }}>
          <Show when={messages().length === 0}>
            <p class="py-12 text-center text-sm text-muted-foreground">Send a message to start chatting.</p>
          </Show>
          <For each={messages()}>
            {(msg) => (
              <div class={\`flex \${msg.role === 'user' ? 'justify-end' : 'justify-start'}\`}>
                <div class={\`max-w-[80%] rounded-lg px-3 py-2 text-sm \${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }\`}>
                  {msg.content}
                </div>
              </div>
            )}
          </For>
          <Show when={loading()}>
            <div class="flex justify-start">
              <div class="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Thinking...</div>
            </div>
          </Show>
        </div>

        <form onSubmit={send} class="mt-3 flex gap-2">
          <input
            value={input()}
            onInput={e => setInput(e.currentTarget.value)}
            placeholder="Type a message..."
            disabled={loading()}
            class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading()}
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}
`
}

// ─── Demo pages (secondary frameworks) ─────────────────────

function demoPageConfig(fw: 'react' | 'vue' | 'solid'): string {
  switch (fw) {
    case 'vue':
      return `import type { Config } from 'vike/types'
import vikeVue from 'vike-vue/config'

export default {
  extends: vikeVue,
} satisfies Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} satisfies Config
`
    default: // react
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} satisfies Config
`
  }
}

function demoPage(fw: 'react' | 'vue' | 'solid', ctx: TemplateContext): string {
  const { primary, tailwind } = ctx

  switch (fw) {
    case 'react':
      if (tailwind) {
        return `export default function Page() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-bold">Hello from React</h1>
      <p className="text-muted-foreground">React demo page — running alongside ${primary}.</p>
      <a href="/" className="text-sm underline">← Back to home</a>
    </div>
  )
}
`
      }
      return `export default function Page() {
  return (
    <div>
      <h1>Hello from React</h1>
      <p>React demo page — running alongside ${primary}.</p>
      <a href="/">← Back to home</a>
    </div>
  )
}
`

    case 'vue':
      if (tailwind) {
        return `<script setup lang="ts">
import '@/index.css'
</script>

<template>
  <div class="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
    <h1 class="text-2xl font-bold">Hello from Vue</h1>
    <p class="text-muted-foreground">Vue demo page — running alongside ${primary}.</p>
    <a href="/" class="text-sm underline">← Back to home</a>
  </div>
</template>
`
      }
      return `<template>
  <div>
    <h1>Hello from Vue</h1>
    <p>Vue demo page — running alongside ${primary}.</p>
    <a href="/">← Back to home</a>
  </div>
</template>
`

    case 'solid':
      if (tailwind) {
        return `import '@/index.css'

export default function Page() {
  return (
    <div class="flex min-h-svh flex-col items-center justify-center gap-4 p-4">
      <h1 class="text-2xl font-bold">Hello from Solid</h1>
      <p class="text-muted-foreground">Solid demo page — running alongside ${primary}.</p>
      <a href="/" class="text-sm underline">← Back to home</a>
    </div>
  )
}
`
      }
      return `export default function Page() {
  return (
    <div>
      <h1>Hello from Solid</h1>
      <p>Solid demo page — running alongside ${primary}.</p>
      <a href="/">← Back to home</a>
    </div>
  )
}
`
  }
}

