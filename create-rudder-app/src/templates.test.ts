import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getTemplates, pmExec, pmRun, pmInstall, type TemplateContext } from './templates.js'

// ─── Helpers ───────────────────────────────────────────────

const defaultPkgs: TemplateContext['packages'] = {
  auth: true, cache: true, queue: false, storage: false,
  mail: false, notifications: false, scheduler: false,
  broadcast: false, live: false, ai: false, mcp: false, passport: false, localization: false,
}

const noPkgs: TemplateContext['packages'] = {
  auth: false, cache: false, queue: false, storage: false,
  mail: false, notifications: false, scheduler: false,
  broadcast: false, live: false, ai: false, mcp: false, passport: false, localization: false,
}

const noAuth: TemplateContext['packages'] = {
  auth: false, cache: true, queue: false, storage: false,
  mail: false, notifications: false, scheduler: false,
  broadcast: false, live: false, ai: false, mcp: false, passport: false, localization: false,
}

const allPkgs: TemplateContext['packages'] = {
  auth: true, cache: true, queue: true, storage: true,
  mail: true, notifications: true, scheduler: true,
  broadcast: true, live: true, ai: true, mcp: true, passport: true, localization: true,
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
  it('generates +server.ts', () => assert.ok('+server.ts' in files))
  it('generates config/log.ts', () => assert.ok('config/log.ts' in files))
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
  // Single-framework projects now use a controller-returned view for `/` —
  // app/Views/Welcome.* wired via Route.get('/', () => view('welcome', ...)) in
  // routes/web.ts. The old pages/index/+Page.* only survives in multi-framework
  // mode (where the scanner can't pick a single framework).

  it('React primary generates Welcome.tsx + _error page', () => {
    const files = getTemplates(ctx({ frameworks: ['react'], primary: 'react' }))
    assert.ok('app/Views/Welcome.tsx' in files)
    assert.ok(!('pages/index/+Page.tsx' in files))
    assert.ok('pages/_error/+Page.tsx' in files)
  })

  it('Vue primary generates Welcome.vue + _error page', () => {
    const files = getTemplates(ctx({ frameworks: ['vue'], primary: 'vue' }))
    assert.ok('app/Views/Welcome.vue' in files)
    assert.ok(!('pages/index/+Page.vue' in files))
    assert.ok('pages/_error/+Page.vue' in files)
  })

  it('Solid primary generates Welcome.tsx + _error page', () => {
    const files = getTemplates(ctx({ frameworks: ['solid'], primary: 'solid' }))
    assert.ok('app/Views/Welcome.tsx' in files)
    assert.ok(!('pages/index/+Page.tsx' in files))
  })

  it('multi-framework projects keep pages/index (view scanner only handles one framework)', () => {
    const files = getTemplates(ctx({ frameworks: ['react', 'vue'], primary: 'react' }))
    assert.ok('pages/index/+Page.tsx' in files)
    assert.ok(!('app/Views/Welcome.tsx' in files))
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

// ─── Auth views ────────────────────────────────────────────
// Auth view files (Login/Register/...) are NOT generated inline — they live in
// @rudderjs/auth/views/ and are copied into app/Views/Auth/ after install,
// or published via: rudder vendor:publish --tag=auth-views-{framework}
// Routes are wired in routes/web.ts via registerAuthRoutes(Route).

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

  it('welcome view and routes/web.ts register /login when auth is selected', () => {
    const files = getTemplates(ctx({ packages: { ...defaultPkgs, auth: true }, tailwind: true }))
    const welcome = files['app/Views/Welcome.tsx']!
    const web     = files['routes/web.ts']!
    // The Welcome component falls back to /login and /register as defaults.
    assert.ok(welcome.includes('/login'))
    assert.ok(welcome.includes('/register'))
    // routes/web.ts wires registerAuthRoutes() and the welcome route.
    assert.ok(web.includes('registerAuthRoutes'))
    assert.ok(web.includes("view('welcome'"))
  })

  it('welcome view still exists without auth; routes/web.ts skips registerAuthRoutes', () => {
    const files = getTemplates(ctx({ packages: noAuth }))
    const welcome = files['app/Views/Welcome.tsx']!
    const web     = files['routes/web.ts']!
    // Welcome still ships — it just never shows a signed-in user.
    assert.ok(welcome.length > 0)
    assert.ok(!web.includes('registerAuthRoutes'))
    assert.ok(web.includes("view('welcome'"))
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
    assert.ok('shadcn' in pkg.devDependencies)
    assert.ok('class-variance-authority' in pkg.dependencies)
  })

  it('does not include shadcn deps when shadcn=false', () => {
    const files = getTemplates(ctx({ shadcn: false }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!('shadcn' in pkg.devDependencies))
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

  it('includes User + PasswordResetToken models when auth selected', () => {
    const schema = getTemplates(ctx())['prisma/schema/auth.prisma']!
    assert.ok(schema.includes('model User {'))
    assert.ok(schema.includes('password      String?'))
    assert.ok(schema.includes('rememberToken String?'))
    assert.ok(schema.includes('model PasswordResetToken {'))
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

  it('providers.ts uses defaultProviders() regardless of selection', () => {
    const min = getTemplates(ctx({ packages: noPkgs }))['bootstrap/providers.ts']!
    const full = getTemplates(ctx({ packages: allPkgs }))['bootstrap/providers.ts']!
    for (const providers of [min, full]) {
      assert.ok(providers.includes('defaultProviders'))
      assert.ok(providers.includes('eventsProvider'))
      assert.ok(providers.includes('AppServiceProvider'))
    }
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

// ─── +server.ts + vike-photon removal ─────────────────────

describe('getTemplates() — +server.ts and vike-photon removal', () => {
  it('+server.ts wires bootstrap/app fetch to Vike', () => {
    const files = getTemplates(ctx())
    const server = files['+server.ts']!
    assert.ok(server.includes("import app from './bootstrap/app.js'"))
    assert.ok(server.includes('fetch: app.fetch'))
    assert.ok(server.includes('satisfies Server'))
  })

  it('package.json includes @vikejs/hono, not vike-photon', () => {
    const files = getTemplates(ctx())
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@vikejs/hono' in pkg.dependencies)
    assert.ok(!('vike-photon' in pkg.dependencies))
  })

  it('pages/+config.ts does not reference vike-photon', () => {
    const files = getTemplates(ctx())
    const config = files['pages/+config.ts']!
    assert.ok(!config.includes('vike-photon'))
    assert.ok(!config.includes('photon'))
    assert.ok(config.includes('satisfies Config'))
  })
})

// ─── log + hash configs ──────────────────────────────────

describe('getTemplates() — log and hash configs', () => {
  it('config/log.ts always generated', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok('config/log.ts' in files)
    assert.ok(files['config/log.ts']!.includes('LogConfig'))
  })

  it('config/hash.ts generated when auth selected', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, auth: true } }))
    assert.ok('config/hash.ts' in files)
    assert.ok(files['config/hash.ts']!.includes('HashConfig'))
  })

  it('config/hash.ts not generated when auth not selected', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok(!('config/hash.ts' in files))
  })

  it('@rudderjs/log always in base deps', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/log' in pkg.dependencies)
  })

  it('@rudderjs/hash in deps when auth selected', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, auth: true } }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/hash' in pkg.dependencies)
  })

  it('providers.ts delegates to defaultProviders() — framework providers auto-discovered', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    const providers = files['bootstrap/providers.ts']!
    // After the auto-discovery migration, @rudderjs/log and @rudderjs/hash
    // are resolved at boot time via providers:discover, not listed literally.
    assert.ok(providers.includes('defaultProviders'))
    assert.ok(!providers.includes('@rudderjs/log'))
  })

  it('config/index.ts includes log', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok(files['config/index.ts']!.includes("from './log.js'"))
  })

  it('config/index.ts includes hash when auth selected', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, auth: true } }))
    assert.ok(files['config/index.ts']!.includes("from './hash.js'"))
  })
})

// ─── live config ──────────────────────────────────────────

describe('getTemplates() — live config wiring', () => {
  it('live selected → config/live.ts generated and wired into config/index.ts', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, live: true } }))
    assert.ok('config/live.ts' in files)
    assert.ok(files['config/live.ts']!.includes('LiveConfig'))
    assert.ok(files['config/index.ts']!.includes("from './live.js'"))
  })

  it('live + prisma → livePrisma() persistence', () => {
    const files = getTemplates(ctx({ orm: 'prisma', packages: { ...noPkgs, live: true } }))
    assert.ok(files['config/live.ts']!.includes('livePrisma'))
  })

  it('live not selected → no config/live.ts, no live import in config/index.ts', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok(!('config/live.ts' in files))
    assert.ok(!files['config/index.ts']!.includes("from './live.js'"))
  })

  it('live selected → @rudderjs/live in deps', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, live: true } }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/live' in pkg.dependencies)
  })
})

// ─── mcp package ──────────────────────────────────────────

describe('getTemplates() — mcp package', () => {
  it('mcp selected → @rudderjs/mcp in deps + demo server/tool scaffolded', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, mcp: true } }))
    assert.ok('app/Mcp/EchoServer.ts' in files)
    assert.ok('app/Mcp/EchoTool.ts' in files)
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/mcp' in pkg.dependencies)
  })

  it('mcp selected → AppServiceProvider registers Mcp.web(...)', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, mcp: true } }))
    const provider = files['app/Providers/AppServiceProvider.ts']!
    assert.ok(provider.includes("from '@rudderjs/mcp'"))
    assert.ok(provider.includes("Mcp.web('/mcp/echo', EchoServer)"))
  })

  it('mcp not selected → no Mcp files, no @rudderjs/mcp dep', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok(!('app/Mcp/EchoServer.ts' in files))
    assert.ok(!('app/Mcp/EchoTool.ts' in files))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!('@rudderjs/mcp' in pkg.dependencies))
    assert.ok(!files['app/Providers/AppServiceProvider.ts']!.includes('@rudderjs/mcp'))
  })

  it('EchoTool uses zod schema and returns McpResponse', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, mcp: true } }))
    const tool = files['app/Mcp/EchoTool.ts']!
    assert.ok(tool.includes("import { z } from 'zod'"))
    assert.ok(tool.includes('McpResponse.text'))
  })
})

// ─── passport package ────────────────────────────────────

describe('getTemplates() — passport package', () => {
  const passportCtx = () => ctx({
    orm: 'prisma',
    packages: { ...noPkgs, auth: true, passport: true },
  })

  it('passport selected → @rudderjs/passport in deps', () => {
    const files = passportCtx() ? getTemplates(passportCtx()) : null
    const pkg = JSON.parse(files!['package.json']!)
    assert.ok('@rudderjs/passport' in pkg.dependencies)
  })

  it('passport selected → prisma/schema/passport.prisma generated', () => {
    const files = getTemplates(passportCtx())
    assert.ok('prisma/schema/passport.prisma' in files)
    const schema = files['prisma/schema/passport.prisma']!
    assert.ok(schema.includes('model OAuthClient'))
    assert.ok(schema.includes('model OAuthAccessToken'))
    assert.ok(schema.includes('model OAuthRefreshToken'))
    assert.ok(schema.includes('model OAuthAuthCode'))
    assert.ok(schema.includes('model OAuthDeviceCode'))
  })

  it('passport selected → config/passport.ts generated and wired into config/index.ts', () => {
    const files = getTemplates(passportCtx())
    assert.ok('config/passport.ts' in files)
    assert.ok(files['config/passport.ts']!.includes('PassportConfig'))
    assert.ok(files['config/index.ts']!.includes("from './passport.js'"))
  })

  it('passport selected → routes/api.ts registers passport routes + example', () => {
    const api = getTemplates(passportCtx())['routes/api.ts']!
    assert.ok(api.includes("from '@rudderjs/passport'"))
    assert.ok(api.includes('registerPassportRoutes(passportRouter'))
    assert.ok(api.includes('/api/passport/me'))
    assert.ok(api.includes('RequireBearer()'))
    assert.ok(api.includes("scope('read')"))
  })

  it('passport not selected → no passport files, no dep', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok(!('prisma/schema/passport.prisma' in files))
    assert.ok(!('config/passport.ts' in files))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!('@rudderjs/passport' in pkg.dependencies))
    assert.ok(!files['routes/api.ts']!.includes('@rudderjs/passport'))
  })
})
