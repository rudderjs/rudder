import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { getTemplates, type TemplateContext } from './templates.js'

// Wide-coverage context: prisma + sqlite + react + vue + tailwind + shadcn + every
// optional package selected. Triggers most code paths in templates.ts.
const ctx: TemplateContext = {
  name:       'snapshot-app',
  db:         'sqlite',
  orm:        'prisma',
  authSecret: 'a'.repeat(64),
  appKey:     'b'.repeat(44),
  frameworks: ['react', 'vue'],
  primary:    'react',
  tailwind:   true,
  shadcn:     true,
  pm:         'pnpm',
  packages: {
    auth:          true,
    sanctum:       true,
    passport:      true,
    socialite:     true,
    queue:         true,
    storage:       true,
    scheduler:     true,
    image:         true,
    mail:          true,
    notifications: true,
    broadcast:     true,
    sync:          true,
    ai:            true,
    mcp:           true,
    boost:         true,
    localization:  true,
    pennant:       true,
    telescope:     true,
    pulse:         true,
    horizon:       true,
    crypt:         true,
    http:          true,
    process:       true,
    concurrency:   true,
    terminal:      true,
  },
  demos: ['contact', 'ws', 'sync'],
}

test('getTemplates() output is byte-stable across refactor', () => {
  const out = getTemplates(ctx)
  const paths = Object.keys(out).sort()
  const totalBytes = paths.reduce((sum, p) => sum + out[p]!.length, 0)

  const hash = createHash('sha256')
  for (const p of paths) {
    hash.update(p)
    hash.update('\0')
    hash.update(out[p]!)
    hash.update('\0')
  }
  const contentHash = hash.digest('hex')

  // Baseline last captured 2026-05-15 — scaffolded package.json template now
  // emits an `engines.node` field matching Vite 7's + Vike's required runtime
  // floor (`^20.19.0 || >=22.12.0`).
  // If you change any template's output deliberately, recapture all four assertions.
  assert.equal(paths.length, EXPECTED_FILE_COUNT, 'file count drifted')
  assert.equal(totalBytes, EXPECTED_TOTAL_BYTES, 'total bytes drifted')
  assert.equal(contentHash, EXPECTED_CONTENT_HASH, 'content hash drifted (some file content changed)')
  assert.deepEqual(paths, EXPECTED_PATHS, 'file set drifted')
})

const EXPECTED_FILE_COUNT = 65
const EXPECTED_TOTAL_BYTES = 65497
const EXPECTED_CONTENT_HASH = '5b3f885370454a07704452df736dd62794ffbb25f95cde349db8e31cdac76c37'
const EXPECTED_PATHS = [
  '+server.ts',
  '.env',
  '.env.example',
  '.gitignore',
  'app/Http/Controllers/AuthController.ts',
  'app/Mcp/EchoServer.ts',
  'app/Mcp/EchoTool.ts',
  'app/Models/User.ts',
  'app/Providers/AppServiceProvider.ts',
  'app/Terminal/Dashboard.tsx',
  'app/Views/Demos/Contact.tsx',
  'app/Views/Demos/Index.tsx',
  'app/Views/Demos/Sync.tsx',
  'app/Views/Demos/Ws.tsx',
  'bootstrap/app.ts',
  'bootstrap/providers.ts',
  'config/ai.ts',
  'config/app.ts',
  'config/auth.ts',
  'config/cache.ts',
  'config/crypt.ts',
  'config/database.ts',
  'config/hash.ts',
  'config/horizon.ts',
  'config/index.ts',
  'config/localization.ts',
  'config/log.ts',
  'config/mail.ts',
  'config/passport.ts',
  'config/pennant.ts',
  'config/pulse.ts',
  'config/queue.ts',
  'config/sanctum.ts',
  'config/server.ts',
  'config/session.ts',
  'config/socialite.ts',
  'config/storage.ts',
  'config/sync.ts',
  'config/telescope.ts',
  'env.d.ts',
  'package.json',
  'pages/+config.ts',
  'pages/_error/+Page.tsx',
  'pages/_error/+config.ts',
  'pages/ai-chat/+Page.tsx',
  'pages/ai-chat/+config.ts',
  'pages/index/+Page.tsx',
  'pages/index/+config.ts',
  'pages/index/+data.ts',
  'pages/vue-demo/+Page.vue',
  'pages/vue-demo/+config.ts',
  'pnpm-workspace.yaml',
  'prisma.config.ts',
  'prisma/schema/auth.prisma',
  'prisma/schema/base.prisma',
  'prisma/schema/modules.prisma',
  'prisma/schema/notification.prisma',
  'prisma/schema/passport.prisma',
  'routes/api.ts',
  'routes/console.ts',
  'routes/web.ts',
  'src/RudderSocket.ts',
  'src/index.css',
  'tsconfig.json',
  'vite.config.ts',
]
