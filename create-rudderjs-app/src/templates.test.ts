import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getTemplates, pmExec, pmRun, pmInstall, type TemplateContext } from './templates.js'

// ─── Helpers ───────────────────────────────────────────────

const defaultPkgs: TemplateContext['packages'] = {
  auth: true, cache: true, queue: false, storage: false,
  mail: false, notifications: false, scheduler: false,
  broadcast: false, live: false, ai: false,
}

const noPkgs: TemplateContext['packages'] = {
  auth: false, cache: false, queue: false, storage: false,
  mail: false, notifications: false, scheduler: false,
  broadcast: false, live: false, ai: false,
}

const noAuth: TemplateContext['packages'] = {
  auth: false, cache: true, queue: false, storage: false,
  mail: false, notifications: false, scheduler: false,
  broadcast: false, live: false, ai: false,
}

const allPkgs: TemplateContext['packages'] = {
  auth: true, cache: true, queue: true, storage: true,
  mail: true, notifications: true, scheduler: true,
  broadcast: true, live: true, ai: true,
}

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    name:       'my-app',
    db:         'sqlite',
    orm:        'prisma' as const,
    withTodo:   false,
    authSecret: 'test-secret',
    frameworks: ['react'] as ('react' | 'vue' | 'solid')[],
    primary:    'react' as const,
    tailwind:   true,
    shadcn:     false,
    pm:         'pnpm' as const,
    packages:   defaultPkgs,
    ...overrides,
  }
}

// ─── File set ──────────────────────────────────────────────

describe('getTemplates() — core files always present', () => {
  const files = getTemplates(ctx())

  it('generates package.json', () => assert.ok('package.json' in files))
  it('generates pnpm-workspace.yaml for pnpm', () => assert.ok('pnpm-workspace.yaml' in files))
  it('generates tsconfig.json', () => assert.ok('tsconfig.json' in files))
  it('generates vite.config.ts', () => assert.ok('vite.config.ts' in files))
  it('generates .env', () => assert.ok('.env' in files))
  it('generates .env.example', () => assert.ok('.env.example' in files))
  it('generates .gitignore', () => assert.ok('.gitignore' in files))
  it('generates prisma/schema/base.prisma when orm=prisma', () => assert.ok('prisma/schema/base.prisma' in files))
  it('generates bootstrap/app.ts', () => assert.ok('bootstrap/app.ts' in files))
  it('generates bootstrap/providers.ts', () => assert.ok('bootstrap/providers.ts' in files))
  it('generates routes/api.ts', () => assert.ok('routes/api.ts' in files))
  it('generates routes/web.ts', () => assert.ok('routes/web.ts' in files))
  it('generates routes/console.ts', () => assert.ok('routes/console.ts' in files))
  it('generates config/index.ts', () => assert.ok('config/index.ts' in files))
})

// ─── Tailwind / shadcn ─────────────────────────────────────

describe('getTemplates() — tailwind + shadcn', () => {
  it('generates src/index.css when tailwind=true', () => {
    const files = getTemplates(ctx({ tailwind: true }))
    assert.ok('src/index.css' in files)
  })

  it('does not generate src/index.css when tailwind=false', () => {
    const files = getTemplates(ctx({ tailwind: false, shadcn: false }))
    assert.ok(!('src/index.css' in files))
  })

  it('index.css contains shadcn import when shadcn=true', () => {
    const files = getTemplates(ctx({ tailwind: true, shadcn: true }))
    assert.ok(files['src/index.css']!.includes('shadcn/tailwind.css'))
  })

  it('index.css does not contain shadcn import when shadcn=false', () => {
    const files = getTemplates(ctx({ tailwind: true, shadcn: false }))
    assert.ok(!files['src/index.css']!.includes('shadcn/tailwind.css'))
  })
})

// ─── Todo module ───────────────────────────────────────────

describe('getTemplates() — Todo module', () => {
  it('generates Todo files when withTodo=true', () => {
    const files = getTemplates(ctx({ withTodo: true }))
    assert.ok('app/Modules/Todo/TodoService.ts' in files)
    assert.ok('app/Modules/Todo/TodoSchema.ts' in files)
    assert.ok('app/Modules/Todo/TodoServiceProvider.ts' in files)
  })

  it('does not generate Todo files when withTodo=false', () => {
    const files = getTemplates(ctx({ withTodo: false }))
    assert.ok(!('app/Modules/Todo/TodoService.ts' in files))
  })

  it('prisma schema includes Todo model when withTodo=true', () => {
    const files = getTemplates(ctx({ withTodo: true }))
    assert.ok(files['prisma/schema/todo.prisma']!.includes('model Todo {'))
  })

  it('prisma schema does not include Todo model when withTodo=false', () => {
    const files = getTemplates(ctx({ withTodo: false }))
    assert.ok(!('prisma/schema/todo.prisma' in files))
  })
})

// ─── Framework page extensions ─────────────────────────────

describe('getTemplates() — framework page files', () => {
  it('React primary generates .tsx pages', () => {
    const files = getTemplates(ctx({ frameworks: ['react'], primary: 'react' }))
    assert.ok('pages/index/+Page.tsx' in files)
    assert.ok('pages/_error/+Page.tsx' in files)
  })

  it('Vue primary generates .vue pages', () => {
    const files = getTemplates(ctx({ frameworks: ['vue'], primary: 'vue' }))
    assert.ok('pages/index/+Page.vue' in files)
    assert.ok('pages/_error/+Page.vue' in files)
  })

  it('Solid primary generates .tsx pages', () => {
    const files = getTemplates(ctx({ frameworks: ['solid'], primary: 'solid' }))
    assert.ok('pages/index/+Page.tsx' in files)
  })
})

// ─── Secondary framework demo pages ────────────────────────

describe('getTemplates() — secondary framework demo pages', () => {
  it('generates vue-demo page when React is primary and Vue is secondary', () => {
    const files = getTemplates(ctx({ frameworks: ['react', 'vue'], primary: 'react' }))
    assert.ok('pages/vue-demo/+Page.vue' in files)
    assert.ok('pages/vue-demo/+config.ts' in files)
    assert.ok(!('pages/react-demo/+Page.tsx' in files))
  })

  it('generates solid-demo page when React is primary and Solid is secondary', () => {
    const files = getTemplates(ctx({ frameworks: ['react', 'solid'], primary: 'react' }))
    assert.ok('pages/solid-demo/+Page.tsx' in files)
    assert.ok(!('pages/react-demo/+Page.tsx' in files))
  })

  it('generates two demo pages for three frameworks', () => {
    const files = getTemplates(ctx({ frameworks: ['react', 'vue', 'solid'], primary: 'react' }))
    assert.ok('pages/vue-demo/+Page.vue' in files)
    assert.ok('pages/solid-demo/+Page.tsx' in files)
    assert.ok(!('pages/react-demo/+Page.tsx' in files))
  })

  it('no demo pages when only one framework selected', () => {
    const files = getTemplates(ctx({ frameworks: ['react'], primary: 'react' }))
    assert.ok(!('pages/vue-demo/+Page.vue' in files))
    assert.ok(!('pages/solid-demo/+Page.tsx' in files))
  })
})

// ─── Auth pages ────────────────────────────────────────────
// Auth page files (login/register) are NOT generated inline — they live in
// @rudderjs/auth/pages/ and are copied from node_modules after install,
// or published via: rudder vendor:publish --tag=auth-pages-{framework}

describe('getTemplates() — auth pages', () => {
  it('never generates login/register page files (come from @rudderjs/auth)', () => {
    const withAuthFiles    = getTemplates(ctx({ packages: { ...defaultPkgs, auth: true } }))
    const withoutAuthFiles = getTemplates(ctx({ packages: noAuth }))
    for (const files of [withAuthFiles, withoutAuthFiles]) {
      assert.ok(!('pages/login/+Page.tsx' in files))
      assert.ok(!('pages/login/+guard.ts' in files))
      assert.ok(!('pages/register/+Page.tsx' in files))
    }
  })

  it('home page includes login/register links when auth selected', () => {
    const files = getTemplates(ctx({ packages: { ...defaultPkgs, auth: true }, tailwind: true }))
    const page  = files['pages/index/+Page.tsx']!
    assert.ok(page.includes('/login'))
    assert.ok(page.includes('/register'))
  })

  it('home page excludes login/register links when auth not selected', () => {
    const files = getTemplates(ctx({ packages: noAuth }))
    const page  = files['pages/index/+Page.tsx']!
    assert.ok(!page.includes('/login'))
    assert.ok(!page.includes('/register'))
  })
})

// ─── package.json content ──────────────────────────────────

describe('getTemplates() — package.json deps', () => {
  it('includes better-sqlite3 for sqlite db', () => {
    const files = getTemplates(ctx({ db: 'sqlite' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('better-sqlite3' in pkg.dependencies)
  })

  it('does not include better-sqlite3 for postgresql', () => {
    const files = getTemplates(ctx({ db: 'postgresql' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!('better-sqlite3' in pkg.dependencies))
  })

  it('includes react deps when React selected', () => {
    const files = getTemplates(ctx({ frameworks: ['react'], primary: 'react' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('react' in pkg.dependencies)
    assert.ok('vike-react' in pkg.dependencies)
  })

  it('includes vue deps when Vue selected', () => {
    const files = getTemplates(ctx({ frameworks: ['vue'], primary: 'vue' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('vue' in pkg.dependencies)
    assert.ok('vike-vue' in pkg.dependencies)
  })

  it('includes solid deps when Solid selected', () => {
    const files = getTemplates(ctx({ frameworks: ['solid'], primary: 'solid' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('solid-js' in pkg.dependencies)
    assert.ok('vike-solid' in pkg.dependencies)
  })

  it('includes shadcn deps when shadcn=true', () => {
    const files = getTemplates(ctx({ shadcn: true, tailwind: true }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('shadcn' in pkg.dependencies)
    assert.ok('class-variance-authority' in pkg.dependencies)
  })

  it('does not include shadcn deps when shadcn=false', () => {
    const files = getTemplates(ctx({ shadcn: false }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!('shadcn' in pkg.dependencies))
  })

  it('includes tailwind deps when tailwind=true', () => {
    const files = getTemplates(ctx({ tailwind: true }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('tailwindcss' in pkg.dependencies)
    assert.ok('@tailwindcss/vite' in pkg.dependencies)
  })

  it('does not include tailwind deps when tailwind=false', () => {
    const files = getTemplates(ctx({ tailwind: false, shadcn: false }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!('tailwindcss' in pkg.dependencies))
  })

  it('sets project name in package.json', () => {
    const files = getTemplates(ctx({ name: 'cool-app' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.strictEqual(pkg.name, 'cool-app')
  })

  it('includes better-sqlite3 in pnpm.onlyBuiltDependencies for sqlite + pnpm', () => {
    const files = getTemplates(ctx({ db: 'sqlite', pm: 'pnpm' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(pkg.pnpm.onlyBuiltDependencies.includes('better-sqlite3'))
  })

  it('uses trustedDependencies for bun', () => {
    const files = getTemplates(ctx({ db: 'sqlite', pm: 'bun' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(Array.isArray(pkg.trustedDependencies))
    assert.ok(pkg.trustedDependencies.includes('better-sqlite3'))
    assert.ok(!pkg.pnpm)
  })

  it('has no pnpm or trustedDependencies for npm', () => {
    const files = getTemplates(ctx({ pm: 'npm' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!pkg.pnpm)
    assert.ok(!pkg.trustedDependencies)
  })

  it('has no pnpm or trustedDependencies for yarn', () => {
    const files = getTemplates(ctx({ pm: 'yarn' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!pkg.pnpm)
    assert.ok(!pkg.trustedDependencies)
  })
})

// ─── pnpm-workspace.yaml ────────────────────────────────────

describe('getTemplates() — pnpm-workspace.yaml', () => {
  it('generates pnpm-workspace.yaml only for pnpm', () => {
    assert.ok('pnpm-workspace.yaml' in getTemplates(ctx({ pm: 'pnpm' })))
    assert.ok(!('pnpm-workspace.yaml' in getTemplates(ctx({ pm: 'npm' }))))
    assert.ok(!('pnpm-workspace.yaml' in getTemplates(ctx({ pm: 'yarn' }))))
    assert.ok(!('pnpm-workspace.yaml' in getTemplates(ctx({ pm: 'bun' }))))
  })
})

// ─── PM helpers ────────────────────────────────────────────

describe('pmExec()', () => {
  it('pnpm: pnpm exec <bin>', () => assert.strictEqual(pmExec('pnpm', 'prisma generate'), 'pnpm exec prisma generate'))
  it('npm: npx <bin>',        () => assert.strictEqual(pmExec('npm',  'prisma generate'), 'npx prisma generate'))
  it('yarn: yarn dlx <bin>',  () => assert.strictEqual(pmExec('yarn', 'prisma generate'), 'yarn dlx prisma generate'))
  it('bun: bunx <bin>',       () => assert.strictEqual(pmExec('bun',  'prisma generate'), 'bunx prisma generate'))
})

describe('pmRun()', () => {
  it('npm: npm run <script>',   () => assert.strictEqual(pmRun('npm',  'dev'), 'npm run dev'))
  it('pnpm: pnpm <script>',    () => assert.strictEqual(pmRun('pnpm', 'dev'), 'pnpm dev'))
  it('yarn: yarn <script>',    () => assert.strictEqual(pmRun('yarn', 'dev'), 'yarn dev'))
  it('bun: bun <script>',      () => assert.strictEqual(pmRun('bun',  'dev'), 'bun dev'))
})

describe('pmInstall()', () => {
  it('pnpm install', () => assert.strictEqual(pmInstall('pnpm'), 'pnpm install'))
  it('npm install',  () => assert.strictEqual(pmInstall('npm'),  'npm install'))
  it('yarn install', () => assert.strictEqual(pmInstall('yarn'), 'yarn install'))
  it('bun install',  () => assert.strictEqual(pmInstall('bun'),  'bun install'))
})

// ─── tsconfig.json content ─────────────────────────────────

describe('getTemplates() — tsconfig.json jsx', () => {
  it('sets jsx=react-jsx for React', () => {
    const files = getTemplates(ctx({ frameworks: ['react'], primary: 'react' }))
    const tsconfig = JSON.parse(files['tsconfig.json']!)
    assert.strictEqual(tsconfig.compilerOptions.jsx, 'react-jsx')
  })

  it('sets jsx=preserve + jsxImportSource=solid-js for Solid only', () => {
    const files = getTemplates(ctx({ frameworks: ['solid'], primary: 'solid' }))
    const tsconfig = JSON.parse(files['tsconfig.json']!)
    assert.strictEqual(tsconfig.compilerOptions.jsx, 'preserve')
    assert.strictEqual(tsconfig.compilerOptions.jsxImportSource, 'solid-js')
  })

  it('omits jsx for Vue only', () => {
    const files = getTemplates(ctx({ frameworks: ['vue'], primary: 'vue' }))
    const tsconfig = JSON.parse(files['tsconfig.json']!)
    assert.ok(!('jsx' in tsconfig.compilerOptions))
  })
})

// ─── prisma schema ─────────────────────────────────────────

describe('getTemplates() — prisma schema', () => {
  it('uses sqlite provider for sqlite db', () => {
    const files = getTemplates(ctx({ db: 'sqlite' }))
    assert.ok(files['prisma/schema/base.prisma']!.includes('provider = "sqlite"'))
  })

  it('uses postgresql provider for postgresql db', () => {
    const files = getTemplates(ctx({ db: 'postgresql' }))
    assert.ok(files['prisma/schema/base.prisma']!.includes('provider = "postgresql"'))
  })

  it('uses mysql provider for mysql db', () => {
    const files = getTemplates(ctx({ db: 'mysql' }))
    assert.ok(files['prisma/schema/base.prisma']!.includes('provider = "mysql"'))
  })

  it('includes User, Session, Account, Verification models when auth selected', () => {
    const schema = getTemplates(ctx())['prisma/schema/auth.prisma']!
    assert.ok(schema.includes('model User {'))
    assert.ok(schema.includes('model Session {'))
    assert.ok(schema.includes('model Account {'))
    assert.ok(schema.includes('model Verification {'))
  })

  it('includes module markers', () => {
    const schema = getTemplates(ctx())['prisma/schema/modules.prisma']!
    assert.ok(schema.includes('// <rudderjs:modules:start>'))
    assert.ok(schema.includes('// <rudderjs:modules:end>'))
  })
})

// ─── .env ──────────────────────────────────────────────────

describe('getTemplates() — .env', () => {
  it('includes app name', () => {
    const files = getTemplates(ctx({ name: 'test-project' }))
    assert.ok(files['.env']!.includes('APP_NAME=test-project'))
  })

  it('includes auth secret when auth selected', () => {
    const files = getTemplates(ctx({ authSecret: 'abc123', packages: { ...defaultPkgs, auth: true } }))
    assert.ok(files['.env']!.includes('AUTH_SECRET=abc123'))
  })

  it('.env.example has placeholder secret when auth selected', () => {
    const files = getTemplates(ctx({ authSecret: 'real-secret', packages: { ...defaultPkgs, auth: true } }))
    assert.ok(!files['.env.example']!.includes('real-secret'))
    assert.ok(files['.env.example']!.includes('please-set'))
  })
})

// ─── Package checklist ────────────────────────────────────

describe('getTemplates() — package checklist', () => {
  it('no database → no prisma files, no config/database.ts', () => {
    const files = getTemplates(ctx({ orm: false, packages: noPkgs }))
    assert.ok(!('prisma/schema/base.prisma' in files))
    assert.ok(!('prisma.config.ts' in files))
    assert.ok(!('config/database.ts' in files))
  })

  it('auth not selected → no auth schema, no config/auth.ts, no @rudderjs/auth in deps', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, cache: true } }))
    assert.ok(!('prisma/schema/auth.prisma' in files))
    assert.ok(!('config/auth.ts' in files))
    assert.ok(!('config/session.ts' in files))
    assert.ok(!('app/Models/User.ts' in files))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!('@rudderjs/auth' in pkg.dependencies))
    assert.ok(!('@rudderjs/session' in pkg.dependencies))
  })

  it('auth selected → auth schema, config/auth.ts, @rudderjs/auth in deps', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, auth: true } }))
    assert.ok('prisma/schema/auth.prisma' in files)
    assert.ok('config/auth.ts' in files)
    assert.ok('config/session.ts' in files)
    assert.ok('app/Models/User.ts' in files)
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/auth' in pkg.dependencies)
    assert.ok('@rudderjs/session' in pkg.dependencies)
  })

  it('cache not selected → no config/cache.ts, no @rudderjs/cache in deps', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok(!('config/cache.ts' in files))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!('@rudderjs/cache' in pkg.dependencies))
  })

  it('queue selected → config/queue.ts, @rudderjs/queue in deps', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, queue: true } }))
    assert.ok('config/queue.ts' in files)
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/queue' in pkg.dependencies)
  })

  it('notifications selected → @rudderjs/notification in deps + prisma schema', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, notifications: true } }))
    assert.ok('prisma/schema/notification.prisma' in files)
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/notification' in pkg.dependencies)
  })

  it('no packages selected → minimal providers.ts', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    const providers = files['bootstrap/providers.ts']!
    assert.ok(providers.includes('AppServiceProvider'))
    assert.ok(!providers.includes('@rudderjs/auth'))
    assert.ok(!providers.includes('@rudderjs/cache'))
    assert.ok(!providers.includes('@rudderjs/queue'))
  })

  it('all packages selected → full providers.ts', () => {
    const files = getTemplates(ctx({ packages: allPkgs }))
    const providers = files['bootstrap/providers.ts']!
    assert.ok(providers.includes('@rudderjs/auth'))
    assert.ok(providers.includes('@rudderjs/cache'))
    assert.ok(providers.includes('@rudderjs/queue'))
    assert.ok(providers.includes('@rudderjs/mail'))
    assert.ok(providers.includes('@rudderjs/storage'))
    assert.ok(providers.includes('@rudderjs/notification'))
    assert.ok(providers.includes('@rudderjs/schedule'))
  })

  it('config/index.ts only re-exports existing configs', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    const index = files['config/index.ts']!
    assert.ok(index.includes("from './app.js'"))
    assert.ok(index.includes("from './server.js'"))
    assert.ok(!index.includes("from './auth.js'"))
    assert.ok(!index.includes("from './cache.js'"))
  })

  it('base deps always included regardless of package selection', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/core' in pkg.dependencies)
    assert.ok('@rudderjs/router' in pkg.dependencies)
    assert.ok('@rudderjs/server-hono' in pkg.dependencies)
    assert.ok('@rudderjs/middleware' in pkg.dependencies)
    assert.ok('@rudderjs/vite' in pkg.dependencies)
  })

  it('.env omits AUTH_SECRET when auth not selected', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok(!files['.env']!.includes('AUTH_SECRET'))
  })

  it('.env includes DATABASE_URL when orm set', () => {
    const files = getTemplates(ctx({ orm: 'prisma' }))
    assert.ok(files['.env']!.includes('DATABASE_URL'))
  })

  it('.env omits DATABASE_URL when orm=false', () => {
    const files = getTemplates(ctx({ orm: false, packages: noPkgs }))
    assert.ok(!files['.env']!.includes('DATABASE_URL'))
  })

  it('prisma config uses schema directory', () => {
    const files = getTemplates(ctx({ orm: 'prisma' }))
    assert.ok(files['prisma.config.ts']!.includes("schema: 'prisma/schema'"))
  })
})
