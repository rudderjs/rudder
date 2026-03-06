export interface TemplateContext {
  name:       string
  db:         'sqlite' | 'postgresql' | 'mysql'
  withTodo:   boolean
  authSecret: string
  frameworks: ('react' | 'vue' | 'solid')[]
  primary:    'react' | 'vue' | 'solid'
  tailwind:   boolean
  shadcn:     boolean
}

function pageExt(fw: 'react' | 'vue' | 'solid'): '.tsx' | '.vue' {
  return fw === 'vue' ? '.vue' : '.tsx'
}

export function getTemplates(ctx: TemplateContext): Record<string, string> {
  const files: Record<string, string> = {}

  files['package.json']      = packageJson(ctx)
  files['tsconfig.json']     = tsconfigJson(ctx)
  files['vite.config.ts']    = viteConfig(ctx)
  files['prisma.config.ts']  = prismaConfig()
  files['.env']              = dotenv(ctx)
  files['.env.example']      = dotenvExample(ctx)
  files['.gitignore']        = gitignore()

  files['prisma/schema.prisma'] = prismaSchema(ctx)

  if (ctx.tailwind) {
    files['src/index.css'] = indexCss(ctx)
  }

  files['bootstrap/app.ts']       = bootstrapApp()
  files['bootstrap/providers.ts'] = bootstrapProviders(ctx)

  files['config/app.ts']      = configApp()
  files['config/server.ts']   = configServer()
  files['config/database.ts'] = configDatabase(ctx)
  files['config/queue.ts']    = configQueue()
  files['config/mail.ts']     = configMail()
  files['config/cache.ts']    = configCache()
  files['config/storage.ts']  = configStorage()
  files['config/auth.ts']     = configAuth(ctx)
  files['config/session.ts']  = configSession()
  files['config/index.ts']    = configIndex()

  files['app/Models/User.ts']                       = userModel()
  files['app/Providers/AppServiceProvider.ts']      = appServiceProvider()
  files['app/Middleware/RequestIdMiddleware.ts']     = requestIdMiddleware()

  files['routes/api.ts']     = routesApi(ctx)
  files['routes/web.ts']     = routesWeb()
  files['routes/console.ts'] = routesConsole()

  const ext = pageExt(ctx.primary)

  files['pages/+config.ts']              = pagesRootConfig()
  files['pages/index/+config.ts']        = pagesIndexConfig(ctx)
  files['pages/index/+data.ts']          = pagesIndexData()
  files[`pages/index/+Page${ext}`]       = pagesIndexPage(ctx)
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

  // Secondary framework demo pages
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
    'shadcn':                   'latest',
    'class-variance-authority': '^0.7.1',
    'clsx':                     '^2.1.1',
    'tailwind-merge':           '^3.5.0',
    'lucide-react':             '^0.575.0',
  } : {}

  const deps = {
    '@boostkit/artisan':      'latest',
    '@boostkit/vite':         'latest',
    '@boostkit/auth':         'latest',
    '@boostkit/cache':        'latest',
    '@boostkit/contracts':    'latest',
    '@boostkit/core':         'latest',
    '@boostkit/di':           'latest',
    '@boostkit/middleware':   'latest',
    '@boostkit/orm':          'latest',
    '@boostkit/orm-prisma':   'latest',
    '@boostkit/queue':        'latest',
    '@boostkit/router':       'latest',
    '@boostkit/schedule':     'latest',
    '@boostkit/server-hono':  'latest',
    '@boostkit/session':      'latest',
    '@boostkit/storage':      'latest',
    '@boostkit/support':      'latest',
    '@boostkit/validation':   'latest',
    '@boostkit/events':       'latest',
    '@boostkit/mail':         'latest',
    '@boostkit/notification': 'latest',
    '@prisma/client':         '^7.0.0',
    'dotenv':                 '^16.4.0',
    'reflect-metadata':       '^0.2.2',
    'vike':                   '^0.4.239',
    'vike-photon':            '^0.1.24',
    'zod':                    '^4.0.0',
    ...frameworkDeps,
    ...tailwindDeps,
    ...shadcnDeps,
    ...dbDeps[db],
  }

  const devDeps = {
    '@boostkit/cli': 'latest',
    '@types/node':   '^20.0.0',
    'prisma':        '^7.0.0',
    'tsx':           '^4.21.0',
    'typescript':    '^5.4.0',
    'vite':          '^7.1.0',
    ...frameworkDevDeps,
    ...tailwindDevDeps,
    ...dbDevDeps[db],
  }

  const onlyBuilt: string[] = ['@prisma/engines', 'esbuild', 'prisma']
  if (db === 'sqlite') onlyBuilt.unshift('better-sqlite3')

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
      artisan:      'tsx node_modules/@boostkit/cli/src/index.ts',
    },
    pnpm: {
      onlyBuiltDependencies: onlyBuilt,
    },
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
    paths:                      { '@/*': ['./src/*'] },
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
    `import boostkit from '@boostkit/vite'`,
  ]
  if (tailwind) imports.push(`import tailwindcss from '@tailwindcss/vite'`)
  if (hasReact)  imports.push(`import react from '@vitejs/plugin-react'`)
  if (hasVue)    imports.push(`import vue from '@vitejs/plugin-vue'`)
  if (hasSolid)  imports.push(`import solid from 'vike-solid/vite'`)

  const plugins: string[] = ['boostkit()']
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

// ─── prisma.config.ts ──────────────────────────────────────

function prismaConfig(): string {
  return `import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'file:./dev.db',
  },
})
`
}

// ─── .env ──────────────────────────────────────────────────

function dotenv(ctx: TemplateContext): string {
  const dbUrl = ctx.db === 'sqlite'
    ? 'DATABASE_URL="file:./dev.db"'
    : ctx.db === 'postgresql'
      ? 'DATABASE_URL="postgresql://user:password@localhost:5432/mydb"'
      : 'DATABASE_URL="mysql://user:password@localhost:3306/mydb"'

  return `APP_NAME=${ctx.name}
APP_ENV=development
APP_DEBUG=true
APP_URL=http://localhost:3000

${dbUrl}

PORT=3000

AUTH_SECRET=${ctx.authSecret}
`
}

// ─── .env.example ──────────────────────────────────────────

function dotenvExample(ctx: TemplateContext): string {
  const dbUrl = ctx.db === 'sqlite'
    ? 'DATABASE_URL="file:./dev.db"'
    : ctx.db === 'postgresql'
      ? 'DATABASE_URL="postgresql://user:password@localhost:5432/mydb"'
      : 'DATABASE_URL="mysql://user:password@localhost:3306/mydb"'

  return `APP_NAME=${ctx.name}
APP_ENV=development
APP_DEBUG=false
APP_URL=http://localhost:3000

${dbUrl}

PORT=3000

AUTH_SECRET=please-set-a-real-32-char-secret-here
`
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

// ─── prisma/schema.prisma ──────────────────────────────────

function prismaSchema(ctx: TemplateContext): string {
  const provider = ctx.db === 'sqlite' ? 'sqlite'
    : ctx.db === 'postgresql' ? 'postgresql'
    : 'mysql'

  const todoModel = ctx.withTodo ? `
// <boostkit:modules:start>
// module: Todo (Todo.prisma)
model Todo {
  id        String   @id @default(cuid())
  title     String
  completed Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
// <boostkit:modules:end>
` : `
// <boostkit:modules:start>
// <boostkit:modules:end>
`

  return `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
}

model User {
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

model Notification {
  id              String  @id @default(cuid())
  notifiable_id   String
  notifiable_type String
  type            String
  data            String
  read_at         String?
  created_at      String
  updated_at      String

  @@index([notifiable_type, notifiable_id])
}
${todoModel}`
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

function bootstrapApp(): string {
  return `import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@boostkit/core'
import { hono } from '@boostkit/server-hono'
import { RateLimit, fromClass } from '@boostkit/middleware'
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
    m.use(RateLimit.perMinute(60))
    m.use(fromClass(RequestIdMiddleware))
  })
  .create()
`
}

// ─── bootstrap/providers.ts ────────────────────────────────

function bootstrapProviders(ctx: TemplateContext): string {
  const todoImport = ctx.withTodo
    ? `import { TodoServiceProvider } from '../app/Modules/Todo/TodoServiceProvider.js'\n`
    : ''
  const todoProvider = ctx.withTodo ? `  TodoServiceProvider,\n` : ''

  return `import type { Application, ServiceProvider } from '@boostkit/core'
import { auth } from '@boostkit/auth'
import { events } from '@boostkit/events'
import { queue } from '@boostkit/queue'
import { mail } from '@boostkit/mail'
import { notifications } from '@boostkit/notification'
import { cache } from '@boostkit/cache'
import { storage } from '@boostkit/storage'
import { scheduler } from '@boostkit/schedule'
import { session } from '@boostkit/session'
import { prismaProvider } from '@boostkit/orm-prisma'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
${todoImport}import configs from '../config/index.js'

export default [
  prismaProvider(configs.database),  // boots first — binds PrismaClient to DI as 'prisma'
  auth(configs.auth),                // auto-discovers 'prisma' from DI
  events({}),
  queue(configs.queue),
  mail(configs.mail),
  notifications(),
  cache(configs.cache),
  storage(configs.storage),
  session(configs.session),
  scheduler(),
  AppServiceProvider,
${todoProvider}] satisfies (new (app: Application) => ServiceProvider)[]
`
}

// ─── config files ──────────────────────────────────────────

function configApp(): string {
  return `import { Env } from '@boostkit/support'

export default {
  name:  Env.get('APP_NAME',  'BoostKit'),
  env:   Env.get('APP_ENV',   'development'),
  debug: Env.getBool('APP_DEBUG', false),
  url:   Env.get('APP_URL', 'http://localhost:3000'),
}
`
}

function configServer(): string {
  return `import { Env } from '@boostkit/support'

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

  return `import { Env } from '@boostkit/support'

export default {
  default: Env.get('DB_CONNECTION', '${defaultConn}'),

  connections: {
${connections[ctx.db]}
  },
}
`
}

function configQueue(): string {
  return `import { Env } from '@boostkit/support'
import type { QueueConfig } from '@boostkit/queue'

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
  return `import { Env } from '@boostkit/support'

export default {
  default: Env.get('MAIL_MAILER', 'log'),

  from: {
    address: Env.get('MAIL_FROM_ADDRESS', 'hello@example.com'),
    name:    Env.get('MAIL_FROM_NAME',    'BoostKit'),
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
  return `import { Env } from '@boostkit/support'
import type { CacheConfig } from '@boostkit/cache'

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
      prefix:   Env.get('CACHE_PREFIX', 'boostkit:'),
    },
  },
} satisfies CacheConfig
`
}

function configStorage(): string {
  return `import path from 'node:path'
import { Env } from '@boostkit/support'
import type { StorageConfig } from '@boostkit/storage'

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
  return `import { Env } from '@boostkit/support'
import type { BetterAuthConfig } from '@boostkit/auth'

export default {
  secret:           Env.get('AUTH_SECRET', 'please-set-AUTH_SECRET-min-32-chars!!'),
  baseUrl:          Env.get('APP_URL', 'http://localhost:3000'),
  emailAndPassword: { enabled: true },
} satisfies BetterAuthConfig
`
}

function configIndex(): string {
  return `import app      from './app.js'
import server   from './server.js'
import database from './database.js'
import queue    from './queue.js'
import mail     from './mail.js'
import cache    from './cache.js'
import storage  from './storage.js'
import session  from './session.js'
import auth     from './auth.js'

export default { app, server, database, queue, mail, cache, storage, session, auth }
`
}

function configSession(): string {
  return `import { Env } from '@boostkit/support'
import type { SessionConfig } from '@boostkit/session'

export default {
  driver:   Env.get('SESSION_DRIVER', 'cookie') as 'cookie' | 'redis',
  lifetime: 120,
  secret:   Env.get('SESSION_SECRET', 'change-me-in-production'),
  cookie: {
    name:     'boostkit_session',
    secure:   Env.getBool('SESSION_SECURE', false),
    httpOnly: true,
    sameSite: 'lax' as const,
    path:     '/',
  },
  redis: { prefix: 'session:', url: Env.get('REDIS_URL', '') },
} satisfies SessionConfig
`
}

// ─── app files ─────────────────────────────────────────────

function userModel(): string {
  return `import { Model } from '@boostkit/orm'

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
  return `import { ServiceProvider } from '@boostkit/core'

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
  return `import { Middleware } from '@boostkit/middleware'
import type { AppRequest, AppResponse } from '@boostkit/contracts'

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
  const todoComment = ctx.withTodo
    ? `\n// Todo routes are registered by TodoServiceProvider — see app/Modules/Todo/TodoServiceProvider.ts\n`
    : ''

  return `import { router } from '@boostkit/router'
import { app } from '@boostkit/core'
import type { BetterAuthInstance } from '@boostkit/auth'
import { RateLimit } from '@boostkit/middleware'

const authLimit = RateLimit.perMinute(10).message('Too many auth attempts. Try again later.')

router.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// GET /api/me — returns current session or null
router.get('/api/me', async (req) => {
  const auth = app().make<BetterAuthInstance>('auth')
  const session = await auth.api.getSession({
    headers: new Headers(req.headers as Record<string, string>),
  })
  return Response.json(session ?? { user: null, session: null })
})
${todoComment}
// All /api/auth/* requests are handled by better-auth
router.all('/api/auth/*', (req) => {
  const auth    = app().make<BetterAuthInstance>('auth')
  const honoCtx = req.raw as { req: { raw: Request } }
  return auth.handler(honoCtx.req.raw)
}, [authLimit])

// Catch-all: any unmatched /api/* route returns 404
router.all('/api/*', (_req, res) => res.status(404).json({ message: 'Route not found.' }))
`
}

function routesWeb(): string {
  return `import { router } from '@boostkit/router'

// Web routes — HTML redirects, guards, and non-API server responses
// These run before Vike's file-based page routing
// Use this file for: redirects, server-side auth guards, download routes, sitemaps, etc.

// Example: redirect root to /todos
// router.get('/', (_req, res) => res.redirect('/todos'))
`
}

function routesConsole(): string {
  return `import { artisan } from '@boostkit/artisan'

artisan.command('inspire', () => {
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

artisan.command('db:seed', async () => {
  // TODO: add your seed data here
  console.log('No seed data configured. Edit routes/console.ts to add seed logic.')
}).description('Seed the database with sample data')
`
}

// ─── pages ─────────────────────────────────────────────────

function pagesRootConfig(): string {
  return `import type { Config } from 'vike/types'
import vikePhoton from 'vike-photon/config'

export default {
  extends: [vikePhoton],
  photon: {
    server: 'bootstrap/app.ts',
  },
} as unknown as Config
`
}

function pagesIndexConfig(ctx: TemplateContext): string {
  switch (ctx.primary) {
    case 'vue':
      return `import type { Config } from 'vike/types'
import vikeVue from 'vike-vue/config'

export default {
  extends: vikeVue,
} as unknown as Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} as unknown as Config
`
    default: // react
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} as unknown as Config
`
  }
}

function pagesIndexData(): string {
  return `import { app } from '@boostkit/core'
import type { BetterAuthInstance } from '@boostkit/auth'

export type Data = {
  user: { id: string; name: string; email: string } | null
}

export async function data(pageContext: unknown): Promise<Data> {
  const auth    = app().make<BetterAuthInstance>('auth')
  const ctx     = pageContext as { headers?: Record<string, string> }
  const session = await auth.api.getSession({
    headers: new Headers(ctx.headers ?? {}),
  })
  return { user: session?.user ?? null }
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
      <p className="text-muted-foreground">Built with BoostKit — Laravel-inspired Node.js framework.</p>

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
          <a
            href="/api/auth/sign-in/email"
            className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
          >
            Sign in
          </a>
        </div>
      )}

      <div className="mt-4 flex gap-3 text-xs text-muted-foreground">
        <a href="/api/health" className="underline hover:text-foreground">API Health</a>
        <a href="/api/me" className="underline hover:text-foreground">Session Info</a>
      </div>
    </div>
  )
}
`
}

function pagesIndexPageVue(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
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
    <p class="text-muted-foreground">Built with BoostKit — Laravel-inspired Node.js framework.</p>

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
      <a href="/api/auth/sign-in/email" class="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">
        Sign in
      </a>
    </div>

    <div class="mt-4 flex gap-3 text-xs text-muted-foreground">
      <a href="/api/health" class="underline hover:text-foreground">API Health</a>
      <a href="/api/me" class="underline hover:text-foreground">Session Info</a>
    </div>
  </div>
</template>
`
}

function pagesIndexPageSolid(ctx: TemplateContext): string {
  const cssImport = ctx.tailwind ? `import '@/index.css'\n` : ''
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
      <p class="text-muted-foreground">Built with BoostKit — Laravel-inspired Node.js framework.</p>

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
          <a
            href="/api/auth/sign-in/email"
            class="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
          >
            Sign in
          </a>
        </div>
      )}

      <div class="mt-4 flex gap-3 text-xs text-muted-foreground">
        <a href="/api/health" class="underline hover:text-foreground">API Health</a>
        <a href="/api/me" class="underline hover:text-foreground">Session Info</a>
      </div>
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
} as unknown as Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} as unknown as Config
`
    default:
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} as unknown as Config
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
  return `import { Injectable } from '@boostkit/di'
import { resolve } from '@boostkit/core'
import type { OrmAdapter } from '@boostkit/orm'
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
  return `import { ServiceProvider } from '@boostkit/core'
import { router } from '@boostkit/router'
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
} as unknown as Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} as unknown as Config
`
    default:
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} as unknown as Config
`
  }
}

function todoPageData(): string {
  return `import { resolve } from '@boostkit/core'
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

// ─── Demo pages (secondary frameworks) ─────────────────────

function demoPageConfig(fw: 'react' | 'vue' | 'solid'): string {
  switch (fw) {
    case 'vue':
      return `import type { Config } from 'vike/types'
import vikeVue from 'vike-vue/config'

export default {
  extends: vikeVue,
} as unknown as Config
`
    case 'solid':
      return `import type { Config } from 'vike/types'
import vikeSolid from 'vike-solid/config'

export default {
  extends: vikeSolid,
} as unknown as Config
`
    default: // react
      return `import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: vikeReact,
} as unknown as Config
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
        return `<template>
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
        return `export default function Page() {
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
