import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { Command } from 'commander'

// ── Package manager detection ─────────────────────────────────

type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

/** Detect PM from npm_config_user_agent (set by every modern PM). Falls back to pnpm. */
function detectPackageManager(): PackageManager {
  const ua = process.env['npm_config_user_agent'] ?? ''
  if (ua.startsWith('pnpm')) return 'pnpm'
  if (ua.startsWith('yarn')) return 'yarn'
  if (ua.startsWith('bun'))  return 'bun'
  if (ua.startsWith('npm'))  return 'npm'
  // If invoked directly via `node bin/rudder.js`, the env var is absent.
  // pnpm-workspace.yaml is the strongest signal for our monorepo / scaffolded apps.
  return 'pnpm'
}

function pmAdd(pm: PackageManager, dep: string): string[] {
  switch (pm) {
    case 'pnpm': return ['add', dep]
    case 'npm':  return ['install', dep]
    case 'yarn': return ['add', dep]
    case 'bun':  return ['add', dep]
  }
}

// ── Package registry ──────────────────────────────────────────
//
// Single source of truth for `rudder add <name>`. Each entry maps a short
// alias to its npm package, optional config template, optional dependencies,
// and the one-line hint we print after successful install.
//
// Packages with no config block (broadcast, http, process, concurrency, image,
// terminal, mcp, boost, notifications, scheduler) work via convention — once
// installed they're picked up by `providers:discover` and the framework's
// auto-discovery does the rest.

type PackageSpec = {
  /** Short name used in `rudder add <name>`. */
  alias:    string
  /** Full npm package name. */
  npmName:  string
  /** Generates the config file body. Pure — no I/O. */
  config?:  { key: string; template: (ctx: { orm: 'prisma' | 'drizzle' | null }) => string }
  /** Other aliases that must already be installed (or selected in the same `add` run). */
  requires?: string[]
  /** When set, the project must use this ORM. */
  requiresOrm?: 'prisma'
  /** One-line post-install hint printed to the user. */
  hint?:    string
}

const REGISTRY: ReadonlyArray<PackageSpec> = [
  // Auth & Security
  { alias: 'auth',          npmName: '@rudderjs/auth',          config: { key: 'auth',          template: () => CFG_AUTH         } },
  { alias: 'sanctum',       npmName: '@rudderjs/sanctum',       config: { key: 'sanctum',       template: () => CFG_SANCTUM      }, requires: ['auth'] },
  { alias: 'passport',      npmName: '@rudderjs/passport',      config: { key: 'passport',      template: () => CFG_PASSPORT     }, requires: ['auth'], requiresOrm: 'prisma', hint: 'OAuth2 ready: /oauth/authorize, /oauth/token  — run `rudder passport:keys` then `rudder passport:client <name>`' },
  { alias: 'socialite',     npmName: '@rudderjs/socialite',     config: { key: 'socialite',     template: () => CFG_SOCIALITE    }, hint: 'Set <PROVIDER>_CLIENT_ID and <PROVIDER>_CLIENT_SECRET in .env (e.g. GITHUB_CLIENT_ID).' },
  { alias: 'crypt',         npmName: '@rudderjs/crypt',         config: { key: 'crypt',         template: () => CFG_CRYPT        }, hint: 'Set APP_KEY in .env (32-byte base64) before encrypting anything.' },

  // Infrastructure
  { alias: 'queue',         npmName: '@rudderjs/queue',         config: { key: 'queue',         template: () => CFG_QUEUE        }, hint: 'Background jobs: `import { Bus } from "@rudderjs/queue"; Bus.dispatch(new MyJob())`.' },
  { alias: 'storage',       npmName: '@rudderjs/storage',       config: { key: 'storage',       template: () => CFG_STORAGE      }, hint: 'File uploads: `import { Storage } from "@rudderjs/storage"; Storage.disk().put(...)`.' },
  { alias: 'scheduler',     npmName: '@rudderjs/schedule',                                                                            hint: 'Schedule tasks in routes/console.ts via `Schedule.command(...)`.' },

  // Communication
  { alias: 'mail',          npmName: '@rudderjs/mail',          config: { key: 'mail',          template: () => CFG_MAIL         }, hint: 'Default mailer is `log` (writes to stdout). Set MAIL_MAILER=smtp + SMTP_* in .env for real delivery.' },
  { alias: 'notifications', npmName: '@rudderjs/notification',                                                                       hint: 'Multi-channel notifications: `rudder make:notification Welcome`.' },
  { alias: 'broadcast',     npmName: '@rudderjs/broadcast',                                                                          hint: 'Real-time channels: define them in routes/channels.ts.' },
  { alias: 'sync',          npmName: '@rudderjs/sync',          config: { key: 'sync',          template: ({ orm }) => buildSyncConfig(orm) }, hint: 'Collaborative Yjs docs: WebSocket endpoint at /ws-sync.' },

  // i18n
  { alias: 'localization',  npmName: '@rudderjs/localization',  config: { key: 'localization',  template: () => CFG_LOCALIZATION }, hint: 'i18n: `import { trans } from "@rudderjs/localization"`.' },

  // Developer experience
  { alias: 'pennant',       npmName: '@rudderjs/pennant',       config: { key: 'pennant',       template: () => CFG_PENNANT      }, hint: 'Feature flags: `import { Feature } from "@rudderjs/pennant"`.' },
  { alias: 'http',          npmName: '@rudderjs/http',                                                                                hint: 'Fluent fetch client: `import { Http } from "@rudderjs/http"`.' },
  { alias: 'process',       npmName: '@rudderjs/process',                                                                             hint: 'Shell execution: `import { Process } from "@rudderjs/process"`.' },
  { alias: 'concurrency',   npmName: '@rudderjs/concurrency',                                                                         hint: 'Worker threads: `import { pool } from "@rudderjs/concurrency"`.' },
  { alias: 'terminal',      npmName: '@rudderjs/terminal',                                                                            hint: 'Rich terminal UI: `rudder make:terminal <Name>`.' },

  // Media
  { alias: 'image',         npmName: '@rudderjs/image',                                                                               hint: 'Image processing: `import { Image } from "@rudderjs/image"`.' },

  // Observability
  { alias: 'telescope',     npmName: '@rudderjs/telescope',     config: { key: 'telescope',     template: () => CFG_TELESCOPE    }, hint: 'Telescope dashboard: /telescope  (requests, queries, jobs, exceptions).' },
  { alias: 'pulse',         npmName: '@rudderjs/pulse',         config: { key: 'pulse',         template: () => CFG_PULSE        }, hint: 'Pulse dashboard: /pulse  (throughput, latency, hit rates).' },
  { alias: 'horizon',       npmName: '@rudderjs/horizon',       config: { key: 'horizon',       template: () => CFG_HORIZON      }, hint: 'Horizon dashboard: /horizon  (queue lifecycle, workers).' },

  // AI & tooling
  { alias: 'ai',            npmName: '@rudderjs/ai',            config: { key: 'ai',            template: () => CFG_AI           }, hint: 'AI agents: set ANTHROPIC_API_KEY (or OPENAI_API_KEY / GOOGLE_AI_API_KEY) in .env.' },
  { alias: 'mcp',           npmName: '@rudderjs/mcp',                                                                                hint: 'Model Context Protocol: `rudder make:mcp-server <Name>`.' },
  { alias: 'boost',         npmName: '@rudderjs/boost',                                                                               hint: 'AI coding DX: `rudder boost:install` to wire your assistant.' },
] as const

function findSpec(name: string): PackageSpec | null {
  const normalized = name.startsWith('@rudderjs/') ? name.slice('@rudderjs/'.length) : name
  return REGISTRY.find(p => p.alias === normalized) ?? null
}

// ── ORM detection ─────────────────────────────────────────────

function detectOrm(cwd: string): 'prisma' | 'drizzle' | null {
  const pkgPath = path.join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return null
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  if ('@rudderjs/orm-prisma'  in deps) return 'prisma'
  if ('@rudderjs/orm-drizzle' in deps) return 'drizzle'
  return null
}

function isInstalled(cwd: string, npmName: string): boolean {
  const pkgPath = path.join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return false
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  return npmName in deps
}

// ── config/index.ts surgical edit ─────────────────────────────

/**
 * Insert a new `import <key> from './<key>.js'` line + a new entry in the
 * `const configs = { ... }` object. Idempotent — bails cleanly if the key is
 * already present or the file shape is too custom to safely edit.
 *
 * Returns `'ok' | 'already-registered' | 'unrecognized-shape'`.
 */
export function registerConfigKey(indexPath: string, key: string): 'ok' | 'already-registered' | 'unrecognized-shape' {
  const src = readFileSync(indexPath, 'utf8')

  // Already wired? Check both the import and the configs map.
  if (new RegExp(`from '\\./${key}\\.js'`).test(src)) return 'already-registered'

  // Find the last `import X from './X.js'` line.
  const importRe = /^import\s+\w+\s+from\s+'\.\/(\w+)\.js'\s*$/gm
  let lastImportEnd = -1
  let match: RegExpExecArray | null
  while ((match = importRe.exec(src)) !== null) lastImportEnd = match.index + match[0].length
  if (lastImportEnd === -1) return 'unrecognized-shape'

  // Find `const configs = { ... }` block.
  const configsRe = /const\s+configs\s*=\s*\{([^}]*)\}/
  const configsMatch = configsRe.exec(src)
  if (!configsMatch) return 'unrecognized-shape'

  // Compose the inserts. Use a uniform import format (no fancy column alignment
  // — we don't try to match the user's spacing — but pad to the visual width of
  // the longest existing import so it still reads cleanly).
  const longestKey = Math.max(...[...src.matchAll(importRe)].map(m => m[1]!.length))
  const padded     = key.padEnd(Math.max(longestKey, key.length))
  const newImport  = `\nimport ${padded} from './${key}.js'`

  const existingKeys = configsMatch[1]!.trim()
  const newKeys      = existingKeys
    ? `${existingKeys.replace(/,?\s*$/, '')}, ${key}`
    : key

  const out = src.slice(0, lastImportEnd) + newImport + src.slice(lastImportEnd, configsMatch.index)
    + `const configs = { ${newKeys} }` + src.slice(configsMatch.index + configsMatch[0].length)

  writeFileSync(indexPath, out)
  return 'ok'
}

// ── Child-process runner ──────────────────────────────────────

function runChild(cmd: string, args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: false })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

// ── Command ───────────────────────────────────────────────────

export function addCommand(program: Command): void {
  program
    .command('add <package>')
    .description('Install a RudderJS package — handles deps, config, and provider discovery')
    .action(async (packageName: string) => {
      const cwd  = process.cwd()
      const spec = findSpec(packageName)
      if (!spec) {
        const valid = REGISTRY.map(p => p.alias).join(', ')
        console.error(`[rudder add] Unknown package "${packageName}".\n  Available: ${valid}`)
        process.exit(1)
      }

      // Idempotency — already installed?
      if (isInstalled(cwd, spec.npmName)) {
        console.log(`  ${spec.npmName} is already installed.`)
        if (spec.config && existsSync(path.join(cwd, 'config', `${spec.config.key}.ts`))) {
          console.log(`  config/${spec.config.key}.ts exists — nothing to do.`)
          return
        }
        // Package installed but config missing — continue and generate it.
      }

      // ORM requirement
      const orm = detectOrm(cwd)
      if (spec.requiresOrm && orm !== spec.requiresOrm) {
        console.error(`[rudder add] ${spec.alias} requires Prisma. Detected: ${orm ?? 'none'}.`)
        console.error(`  Add the ORM first: pnpm add @rudderjs/orm @rudderjs/orm-${spec.requiresOrm}`)
        process.exit(1)
      }

      // Dependency requirements
      if (spec.requires?.length) {
        const pkg  = JSON.parse(readFileSync(path.join(cwd, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
        const deps = pkg.dependencies ?? {}
        for (const req of spec.requires) {
          const reqSpec = REGISTRY.find(p => p.alias === req)
          if (reqSpec && !(reqSpec.npmName in deps)) {
            console.error(`[rudder add] ${spec.alias} requires ${req}. Run \`rudder add ${req}\` first.`)
            process.exit(1)
          }
        }
      }

      // 1. Install the dependency
      const pm = detectPackageManager()
      if (!isInstalled(cwd, spec.npmName)) {
        console.log(`\n  Adding ${spec.npmName}...`)
        const ok = await runChild(pm, pmAdd(pm, spec.npmName), cwd)
        if (!ok) {
          console.error(`[rudder add] ${pm} ${pmAdd(pm, spec.npmName).join(' ')} failed.`)
          process.exit(1)
        }
      }

      // 2. Generate config file (idempotent — skip if exists)
      if (spec.config) {
        const configDir = path.join(cwd, 'config')
        mkdirSync(configDir, { recursive: true })
        const configFile = path.join(configDir, `${spec.config.key}.ts`)
        if (!existsSync(configFile)) {
          const body = spec.config.template({ orm })
          writeFileSync(configFile, body)
          console.log(`  Generated config/${spec.config.key}.ts`)
        }

        // 3. Wire into config/index.ts
        const indexFile = path.join(configDir, 'index.ts')
        if (existsSync(indexFile)) {
          const result = registerConfigKey(indexFile, spec.config.key)
          if (result === 'ok') {
            console.log(`  Registered "${spec.config.key}" in config/index.ts`)
          } else if (result === 'unrecognized-shape') {
            console.warn(`  ⚠ Could not auto-wire config/index.ts (custom shape).`)
            console.warn(`    Add manually: import ${spec.config.key} from './${spec.config.key}.js'`)
          }
        }
      }

      // 4. Refresh provider manifest
      console.log(`  Refreshing provider manifest...`)
      const discoverOk = await runChild(pm, [...(pm === 'npm' ? ['exec'] : []), 'rudder', 'providers:discover'], cwd)
      if (!discoverOk) {
        console.warn(`  ⚠ providers:discover failed — run \`${pm} rudder providers:discover\` manually.`)
      }

      // 5. Print the post-install hint
      console.log()
      console.log(`  ✓ ${spec.alias} is ready.`)
      if (spec.hint) console.log(`    ${spec.hint}`)
    })
}

// ── Config templates (vendored from create-rudder for runtime use) ─────────
//
// Kept inline here rather than pulled from create-rudder via subpath so
// that @rudderjs/cli stays standalone and doesn't depend on the scaffolder.
// These are intentionally near-verbatim copies — the scaffolder owns the
// canonical templates for new-project scaffolding, and this command owns the
// runtime-add path. When the canonical templates evolve, this file gets
// updated in lockstep (one PR touches both).

const CFG_AUTH = `import type { AuthConfig } from '@rudderjs/auth'
import { User } from '../app/Models/User.js'

export default {
  defaults: { guard: 'web' },
  guards: {
    web: { driver: 'session', provider: 'users' },
  },
  providers: {
    users: { driver: 'eloquent', model: User },
  },
} satisfies AuthConfig
`

const CFG_SANCTUM = `import { Env } from '@rudderjs/support'
import type { SanctumConfig } from '@rudderjs/sanctum'

export default {
  expiration: Env.getNumber('SANCTUM_TOKEN_EXPIRATION_MINUTES', 0),
  prefix:     Env.get('SANCTUM_TOKEN_PREFIX', ''),

  // Default abilities granted on token creation.
  defaultAbilities: ['*'],
} satisfies SanctumConfig
`

const CFG_PASSPORT = `import { Env } from '@rudderjs/support'

export default {
  // Path to the RSA keypair generated by \`rudder passport:keys\`.
  privateKey: Env.get('PASSPORT_PRIVATE_KEY_PATH', 'storage/oauth-private.key'),
  publicKey:  Env.get('PASSPORT_PUBLIC_KEY_PATH',  'storage/oauth-public.key'),

  // Token lifetimes (in seconds).
  accessTokenTtl:  Env.getNumber('PASSPORT_ACCESS_TOKEN_TTL',  3600),     // 1h
  refreshTokenTtl: Env.getNumber('PASSPORT_REFRESH_TOKEN_TTL', 1209600),  // 14d
}
`

const CFG_SOCIALITE = `import { Env } from '@rudderjs/support'

export default {
  github: {
    clientId:     Env.get('GITHUB_CLIENT_ID',     ''),
    clientSecret: Env.get('GITHUB_CLIENT_SECRET', ''),
    redirectUri:  Env.get('GITHUB_REDIRECT_URI',  'http://localhost:3000/auth/github/callback'),
  },
  google: {
    clientId:     Env.get('GOOGLE_CLIENT_ID',     ''),
    clientSecret: Env.get('GOOGLE_CLIENT_SECRET', ''),
    redirectUri:  Env.get('GOOGLE_REDIRECT_URI',  'http://localhost:3000/auth/google/callback'),
  },
}
`

const CFG_CRYPT = `import { Env } from '@rudderjs/support'

export default {
  // 32-byte base64 key. Generate with: openssl rand -base64 32
  // Stored in .env as APP_KEY — never commit it.
  key:    Env.get('APP_KEY', ''),
  cipher: Env.get('APP_CIPHER', 'aes-256-cbc'),
}
`

const CFG_QUEUE = `import { Env, isWebContainer } from '@rudderjs/support'
import type { QueueConfig } from '@rudderjs/queue'

// In WebContainer, BullMQ (Redis over raw TCP) doesn't work — fall back to
// the in-process \`sync\` driver.
const defaultConnection = isWebContainer() ? 'sync' : Env.get('QUEUE_CONNECTION', 'sync')

export default {
  default: defaultConnection,

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

const CFG_STORAGE = `import { Env } from '@rudderjs/support'
import type { StorageConfig } from '@rudderjs/storage'

export default {
  default: Env.get('STORAGE_DISK', 'local'),

  disks: {
    local: {
      driver: 'local',
      root:   Env.get('STORAGE_LOCAL_ROOT', 'storage/app'),
    },

    s3: {
      driver:    's3',
      key:       Env.get('AWS_ACCESS_KEY_ID',     ''),
      secret:    Env.get('AWS_SECRET_ACCESS_KEY', ''),
      region:    Env.get('AWS_DEFAULT_REGION',    'us-east-1'),
      bucket:    Env.get('AWS_BUCKET',            ''),
      endpoint:  Env.get('AWS_ENDPOINT',          ''),
    },
  },
} satisfies StorageConfig
`

const CFG_MAIL = `import { Env, isWebContainer } from '@rudderjs/support'

// In WebContainer, raw SMTP (TCP) doesn't work — fall back to the log driver
// (writes the rendered email to stdout instead of sending).
const defaultMailer = isWebContainer() ? 'log' : Env.get('MAIL_MAILER', 'log')

export default {
  default: defaultMailer,

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

function buildSyncConfig(orm: 'prisma' | 'drizzle' | null): string {
  const persistenceImport = orm === 'prisma' ? "\nimport { syncPrisma } from '@rudderjs/sync'" : ''
  const persistenceLine   = orm === 'prisma'
    ? '\n  // Server-side persistence — Y.Docs survive server restarts\n  persistence: syncPrisma(),\n'
    : ''
  return `import { Env } from '@rudderjs/support'${persistenceImport}
import type { SyncConfig } from '@rudderjs/sync'

export default {
  path: Env.get('SYNC_PATH', '/ws-sync'),
${persistenceLine}
  // Client-side providers
  providers: ['websocket', 'indexeddb'],
} satisfies SyncConfig
`
}

const CFG_LOCALIZATION = `import { Env } from '@rudderjs/support'

export default {
  locale:         Env.get('APP_LOCALE',          'en'),
  fallbackLocale: Env.get('APP_FALLBACK_LOCALE', 'en'),

  // Path to translation files (relative to project root).
  path: 'lang',
}
`

const CFG_PENNANT = `import { Env } from '@rudderjs/support'
import type { PennantConfig } from '@rudderjs/pennant'

export default {
  default: Env.get('PENNANT_STORE', 'array'),

  stores: {
    array:    { driver: 'array' },
    database: { driver: 'database', table: 'feature_flags' },
  },
} satisfies PennantConfig
`

const CFG_TELESCOPE = `import { Env } from '@rudderjs/support'
import type { TelescopeConfig } from '@rudderjs/telescope'

export default {
  enabled: Env.getBool('TELESCOPE_ENABLED', true),
  path:    Env.get('TELESCOPE_PATH',        '/telescope'),

  storage: {
    driver: Env.get('TELESCOPE_STORAGE', 'memory'),
  },
} satisfies TelescopeConfig
`

const CFG_PULSE = `import { Env } from '@rudderjs/support'
import type { PulseConfig } from '@rudderjs/pulse'

export default {
  enabled: Env.getBool('PULSE_ENABLED', true),
  path:    Env.get('PULSE_PATH',        '/pulse'),

  storage: {
    driver: Env.get('PULSE_STORAGE', 'memory'),
  },
} satisfies PulseConfig
`

const CFG_HORIZON = `import { Env } from '@rudderjs/support'
import type { HorizonConfig } from '@rudderjs/horizon'

export default {
  enabled: Env.getBool('HORIZON_ENABLED', true),
  path:    Env.get('HORIZON_PATH',        '/horizon'),

  storage: {
    driver: Env.get('HORIZON_STORAGE', 'memory'),
  },
} satisfies HorizonConfig
`

const CFG_AI = `import { Env } from '@rudderjs/support'
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

// ── Test exports ──────────────────────────────────────────────
// (not part of the runtime API, but tests import these directly)
export const _internal = { REGISTRY, findSpec, detectOrm, detectPackageManager }
