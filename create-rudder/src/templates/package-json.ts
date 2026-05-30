import { type PackageManager } from './package-managers.js'
import { type TemplateContext } from '../templates.js'

/**
 * Dependencies whose install/build scripts must be allowed to run. pnpm 10+ and
 * Bun block dependency lifecycle scripts by default, so these need an explicit
 * allowlist (`onlyBuiltDependencies` for pnpm, `trustedDependencies` for Bun) or
 * the native binding / Prisma engine never builds. Shared between the
 * `package.json` field and `pnpm-workspace.yaml` so the two never drift.
 */
export function builtDependencies(ctx: TemplateContext): string[] {
  const built: string[] = ['esbuild']
  if (ctx.orm === 'prisma') built.push('@prisma/engines', 'prisma')
  if (ctx.db === 'sqlite') built.unshift('better-sqlite3')
  return built
}

export function packageJson(ctx: TemplateContext): string {
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
    frameworkDeps['vike-react'] = '^0.6.23'
    frameworkDevDeps['@vitejs/plugin-react'] = '^6.0.0'
    frameworkDevDeps['@types/react']         = '^19.0.0'
    frameworkDevDeps['@types/react-dom']     = '^19.0.0'
  }
  if (hasVue) {
    frameworkDeps['vue']      = '^3.5.0'
    frameworkDeps['vike-vue'] = 'latest'
    frameworkDevDeps['@vitejs/plugin-vue'] = '^6.0.0'
  }
  if (hasSolid) {
    frameworkDeps['solid-js']   = '^1.9.0'
    frameworkDeps['vike-solid'] = 'latest'
  }

  const tailwindDeps: Record<string, string> = tailwind ? {
    'tailwindcss':       '^4.2.1',
    '@tailwindcss/vite': '^4.3.0',
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
    '@rudderjs/console':      'latest',
    '@rudderjs/vite':         'latest',
    '@rudderjs/contracts':    'latest',
    '@rudderjs/core':         'latest',
    '@rudderjs/log':          'latest',
    '@rudderjs/middleware':   'latest',
    '@rudderjs/router':       'latest',
    '@rudderjs/server-hono':  'latest',
    '@rudderjs/support':      'latest',
    '@rudderjs/view':         'latest',
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

  // Tier A — always installed silently. Required by default bootstrap (cache for
  // RateLimit middleware) or peer of Auth (session for cookies/CSRF, hash for
  // password hashing — also useful standalone).
  deps['@rudderjs/session'] = 'latest'
  deps['@rudderjs/hash']    = 'latest'
  deps['@rudderjs/cache']   = 'latest'

  // Optional package deps
  if (ctx.packages.auth)          deps['@rudderjs/auth']         = 'latest'
  if (ctx.packages.sanctum)       deps['@rudderjs/sanctum']      = 'latest'
  if (ctx.packages.passport)      deps['@rudderjs/passport']     = 'latest'
  if (ctx.packages.socialite)     deps['@rudderjs/socialite']    = 'latest'
  if (ctx.packages.queue)         deps['@rudderjs/queue']        = 'latest'
  if (ctx.packages.storage)       deps['@rudderjs/storage']      = 'latest'
  if (ctx.packages.scheduler)     deps['@rudderjs/schedule']     = 'latest'
  if (ctx.packages.image)         deps['@rudderjs/image']        = 'latest'
  if (ctx.packages.mail)          deps['@rudderjs/mail']         = 'latest'
  if (ctx.packages.notifications) deps['@rudderjs/notification'] = 'latest'
  if (ctx.packages.broadcast)     deps['@rudderjs/broadcast']    = 'latest'
  if (ctx.packages.sync) {
    deps['@rudderjs/sync'] = 'latest'
    // yjs is a peer of y-websocket; under pnpm strict-resolution it isn't
    // hoisted, and Vite's dep-scan errors on the explicit `import * as Y from
    // 'yjs'` from @rudderjs/sync. Declare them explicitly so realtime/sync
    // scaffolds boot.
    deps['yjs']            = '^13.6.0'
    deps['y-websocket']    = '^2.0.0'
  }
  if (ctx.packages.ai)            deps['@rudderjs/ai']           = 'latest'
  if (ctx.packages.mcp)           deps['@rudderjs/mcp']          = 'latest'
  if (ctx.packages.localization)  deps['@rudderjs/localization'] = 'latest'
  if (ctx.packages.pennant)       deps['@rudderjs/pennant']      = 'latest'
  if (ctx.packages.telescope)     deps['@rudderjs/telescope']    = 'latest'
  if (ctx.packages.pulse)         deps['@rudderjs/pulse']        = 'latest'
  if (ctx.packages.horizon)       deps['@rudderjs/horizon']      = 'latest'
  if (ctx.packages.crypt)         deps['@rudderjs/crypt']        = 'latest'
  if (ctx.packages.http)          deps['@rudderjs/http']         = 'latest'
  if (ctx.packages.process)       deps['@rudderjs/process']      = 'latest'
  if (ctx.packages.concurrency)   deps['@rudderjs/concurrency']  = 'latest'
  if (ctx.packages.terminal) {
    deps['@rudderjs/terminal'] = 'latest'
    deps['ink']                = '^7.0.0'
  }
  const devDeps: Record<string, string> = {
    '@rudderjs/cli': 'latest',
    '@types/node':   '^20.0.0',
    'tsx':           '^4.21.0',
    'typescript':    '^5.4.0',
    'vite':          '^8.0.0',
    ...frameworkDevDeps,
    ...tailwindDevDeps,
    ...shadcnDevDeps,
    ...dbDevDeps[db],
  }
  if (ctx.orm === 'prisma') devDeps['prisma'] = '^7.0.0'
  if (ctx.packages.boost)   devDeps['@rudderjs/boost'] = 'latest'

  const builtDeps = builtDependencies(ctx)

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
    engines: {
      node: '^20.19.0 || >=22.12.0',
    },
    scripts: {
      dev:               'vike dev',
      'dev:clean':       'pids=$(lsof -ti :24678 -ti :3000 2>/dev/null); if [ -n "$pids" ]; then kill -9 $pids; fi; vike dev',
      build:             'vike build',
      start:             'node ./dist/server/index.mjs',
      preview:           'node ./dist/server/index.mjs',
      typecheck:         'tsc --noEmit',
      rudder:            'tsx node_modules/@rudderjs/cli/dist/index.js',
      ...(ctx.orm ? {
        migrate:          'tsx node_modules/@rudderjs/cli/dist/index.js migrate',
        'migrate:fresh':  'tsx node_modules/@rudderjs/cli/dist/index.js migrate:fresh',
        'migrate:status': 'tsx node_modules/@rudderjs/cli/dist/index.js migrate:status',
        'db:seed':        'tsx node_modules/@rudderjs/cli/dist/index.js db:seed',
      } : {}),
    },
    ...pmField,
    dependencies:    deps,
    devDependencies: devDeps,
  }, null, 2) + '\n'
}
