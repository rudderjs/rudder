import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getTemplates, pmExec, pmRun, pmInstall, type TemplateContext } from './templates.js'

// ─── Helpers ───────────────────────────────────────────────

const defaultPkgs: TemplateContext['packages'] = {
  auth: true, sanctum: false, passport: false, socialite: false,
  queue: false, storage: false, scheduler: false, image: false,
  mail: false, notifications: false, broadcast: false, sync: false,
  ai: false, mcp: false, boost: false,
  localization: false, pennant: false,
  telescope: false, pulse: false, horizon: false,
  crypt: false, http: false, process: false, concurrency: false,
  terminal: false,
}

const noPkgs: TemplateContext['packages'] = {
  auth: false, sanctum: false, passport: false, socialite: false,
  queue: false, storage: false, scheduler: false, image: false,
  mail: false, notifications: false, broadcast: false, sync: false,
  ai: false, mcp: false, boost: false,
  localization: false, pennant: false,
  telescope: false, pulse: false, horizon: false,
  crypt: false, http: false, process: false, concurrency: false,
  terminal: false,
}

const noAuth: TemplateContext['packages'] = noPkgs

const allPkgs: TemplateContext['packages'] = {
  auth: true, sanctum: true, passport: true, socialite: true,
  queue: true, storage: true, scheduler: true, image: true,
  mail: true, notifications: true, broadcast: true, sync: true,
  ai: true, mcp: true, boost: true,
  localization: true, pennant: true,
  telescope: true, pulse: true, horizon: true,
  crypt: true, http: true, process: true, concurrency: true,
  terminal: true,
}

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    name:       'my-app',
    db:         'sqlite',
    orm:        'prisma' as const,
    authSecret: 'test-secret',
    appKey:     'test-app-key',
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
  it('always generates src/index.css regardless of tailwind flag', () => {
    // Both variants ship the same set of semantic class selectors;
    // contents differ (Tailwind @apply vs plain CSS), existence does not.
    assert.ok('src/index.css' in getTemplates(ctx({ tailwind: true })))
    assert.ok('src/index.css' in getTemplates(ctx({ tailwind: false, shadcn: false })))
  })

  it('tailwind=true index.css contains @import "tailwindcss" + @apply rules', () => {
    const css = getTemplates(ctx({ tailwind: true, shadcn: false }))['src/index.css']!
    assert.ok(css.includes('@import "tailwindcss"'))
    assert.ok(css.includes('@apply'))
  })

  it('tailwind=true index.css contains shadcn import when shadcn=true', () => {
    const css = getTemplates(ctx({ tailwind: true, shadcn: true }))['src/index.css']!
    assert.ok(css.includes('shadcn/tailwind.css'))
  })

  it('tailwind=true index.css does not contain shadcn import when shadcn=false', () => {
    const css = getTemplates(ctx({ tailwind: true, shadcn: false }))['src/index.css']!
    assert.ok(!css.includes('shadcn/tailwind.css'))
  })

  it('tailwind=false index.css is hand-authored CSS with no Tailwind directives', () => {
    const css = getTemplates(ctx({ tailwind: false, shadcn: false }))['src/index.css']!
    assert.ok(!css.includes('@import "tailwindcss"'))
    assert.ok(!css.includes('@apply'))
    assert.ok(css.includes('@media (prefers-color-scheme: dark)'))
    assert.ok(css.includes('--bg-start'))
  })

  it('tailwind=false index.css contains semantic class selectors', () => {
    const css = getTemplates(ctx({ tailwind: false, shadcn: false }))['src/index.css']!
    for (const selector of [
      '.page', '.page-nav', '.hero', '.feature-card', '.auth-card', '.form-input', '.error-wrap',
      '.empty-state', '.form-inline',
      '.chat-wrap', '.chat-column', '.chat-log', '.chat-bubble',
    ]) {
      assert.ok(css.includes(selector), `plain CSS missing selector ${selector}`)
    }
  })

  it('tailwind=true index.css contains the same semantic class selectors', () => {
    const css = getTemplates(ctx({ tailwind: true, shadcn: false }))['src/index.css']!
    for (const selector of [
      '.page', '.page-nav', '.hero', '.feature-card', '.auth-card', '.form-input', '.error-wrap',
      '.empty-state', '.form-inline',
      '.chat-wrap', '.chat-column', '.chat-log', '.chat-bubble',
    ]) {
      assert.ok(css.includes(selector), `tailwind CSS missing selector ${selector}`)
    }
  })

  it('Welcome view always imports index.css regardless of tailwind flag', () => {
    const welcomePath = 'app/Views/Welcome.tsx'
    assert.ok(getTemplates(ctx({ tailwind: true,  frameworks: ['react'], primary: 'react' }))[welcomePath]!.includes(`import '@/index.css'`))
    assert.ok(getTemplates(ctx({ tailwind: false, shadcn: false, frameworks: ['react'], primary: 'react' }))[welcomePath]!.includes(`import '@/index.css'`))
  })

  it('tailwind=false omits tailwindcss deps from package.json', () => {
    const pkg = getTemplates(ctx({ tailwind: false, shadcn: false }))['package.json']!
    assert.ok(!pkg.includes('"tailwindcss"'))
    assert.ok(!pkg.includes('"@tailwindcss/vite"'))
    assert.ok(!pkg.includes('"tw-animate-css"'))
  })

  it('tailwind=false omits the tailwindcss() plugin from vite.config.ts', () => {
    const vite = getTemplates(ctx({ tailwind: false, shadcn: false }))['vite.config.ts']!
    assert.ok(!vite.includes('@tailwindcss/vite'))
    assert.ok(!vite.includes('tailwindcss()'))
  })

  it('tailwind=true keeps the tailwindcss deps + vite plugin', () => {
    const pkg  = getTemplates(ctx({ tailwind: true, shadcn: false }))['package.json']!
    const vite = getTemplates(ctx({ tailwind: true, shadcn: false }))['vite.config.ts']!
    assert.ok(pkg.includes('"tailwindcss"'))
    assert.ok(pkg.includes('"@tailwindcss/vite"'))
    assert.ok(vite.includes('@tailwindcss/vite'))
  })

  it('opt-in ai-chat page uses semantic classes, no shadcn-flavored leaks', () => {
    const files = getTemplates(ctx({
      tailwind: false, shadcn: false,
      packages: { ...allPkgs, ai: true },
      frameworks: ['react'], primary: 'react',
    }))
    const aiChat = files['pages/ai-chat/+Page.tsx']!

    for (const leak of ['text-muted-foreground', 'bg-primary', 'text-primary-foreground', 'border-input', 'bg-background', 'bg-muted', 'text-destructive']) {
      assert.ok(!aiChat.includes(leak), `ai-chat page leaks shadcn class: ${leak}`)
    }

    assert.ok(aiChat.includes('form-inline'))
    assert.ok(aiChat.includes('chat-column'))
    assert.ok(aiChat.includes('chat-bubble'))
  })

  it('multi-framework pagesIndexPage uses semantic classes, no shadcn leaks', () => {
    const files = getTemplates(ctx({
      tailwind: false, shadcn: false,
      frameworks: ['react', 'vue'], primary: 'react',
    }))
    const index = files['pages/index/+Page.tsx']!
    for (const leak of ['text-muted-foreground', 'bg-primary', 'text-primary-foreground', 'hover:bg-accent']) {
      assert.ok(!index.includes(leak), `pagesIndexPage leaks shadcn class: ${leak}`)
    }
    assert.ok(index.includes('error-wrap'))
    assert.ok(index.includes('heading-lg'))
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

  it('welcome view delegates auth UI to SiteHeader when auth is selected', () => {
    const files = getTemplates(ctx({ packages: { ...defaultPkgs, auth: true }, tailwind: true }))
    const welcome    = files['app/Views/Welcome.tsx']!
    const siteHeader = files['app/Components/SiteHeader.tsx']!
    const web        = files['routes/web.ts']!
    // Welcome imports the shared SiteHeader; SiteHeader reads user from
    // pageContext (set by @rudderjs/auth's enhancer), so the welcome
    // controller no longer needs to pass loginUrl/registerUrl props.
    assert.ok(welcome.includes("import { SiteHeader } from 'App/Components/SiteHeader.js'"))
    assert.ok(siteHeader.includes('/auth/sign-out'))
    assert.ok(siteHeader.includes("href=\"/login\""))
    assert.ok(siteHeader.includes("href=\"/register\""))
    // routes/web.ts wires registerAuthRoutes() and the welcome route.
    assert.ok(web.includes('registerAuthRoutes(Route'))
    assert.ok(web.includes("view('welcome'"))
  })

  it('welcome view still exists without auth; routes/web.ts skips registerAuthRoutes', () => {
    const files = getTemplates(ctx({ packages: noAuth }))
    const welcome = files['app/Views/Welcome.tsx']!
    const web     = files['routes/web.ts']!
    // Welcome still ships — it just never shows a signed-in user.
    assert.ok(welcome.length > 0)
    // Check the actual call, not the explanatory comment mentioning the name.
    assert.ok(!web.includes('registerAuthRoutes(Route'))
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

  it('emits no package.json#pnpm field for pnpm (ignored + warned by pnpm 11; build approval lives in pnpm-workspace.yaml)', () => {
    const files = getTemplates(ctx({ db: 'sqlite', pm: 'pnpm' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!pkg.pnpm)
    assert.ok(!pkg.trustedDependencies)
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

  it('allows dependency build scripts (works on pnpm 10 + 11) and stays a standalone workspace', () => {
    const ws = getTemplates(ctx({ pm: 'pnpm', db: 'sqlite', orm: 'prisma' }))['pnpm-workspace.yaml']!
    assert.match(ws, /^dangerouslyAllowAllBuilds: true$/m)
    assert.match(ws, /^packages: \[\]/m) // still a standalone (non-merging) workspace
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
    const files = getTemplates(ctx({ packages: { ...noPkgs } }))
    assert.ok(!('prisma/schema/auth.prisma' in files))
    assert.ok(!('config/auth.ts' in files))
    assert.ok(!('app/Models/User.ts' in files))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!('@rudderjs/auth' in pkg.dependencies))
  })

  it('auth selected → auth schema, config/auth.ts, @rudderjs/auth in deps', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, auth: true } }))
    assert.ok('prisma/schema/auth.prisma' in files)
    assert.ok('config/auth.ts' in files)
    assert.ok('app/Models/User.ts' in files)
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/auth' in pkg.dependencies)
  })

  it('Tier A — session/hash/cache always installed regardless of selection', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/session' in pkg.dependencies, 'session must always be in deps')
    assert.ok('@rudderjs/hash'    in pkg.dependencies, 'hash must always be in deps')
    assert.ok('@rudderjs/cache'   in pkg.dependencies, 'cache must always be in deps')
    assert.ok('config/session.ts' in files, 'config/session.ts must always be generated')
    assert.ok('config/hash.ts'    in files, 'config/hash.ts must always be generated')
    assert.ok('config/cache.ts'   in files, 'config/cache.ts must always be generated')
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
    // Tier A — session/hash/cache always wired
    assert.ok(index.includes("from './session.js'"))
    assert.ok(index.includes("from './hash.js'"))
    assert.ok(index.includes("from './cache.js'"))
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

// ─── native engine ─────────────────────────────────────────

describe('getTemplates() — native engine', () => {
  const nativeCtx = (pkgs = defaultPkgs) => ctx({ orm: 'native', db: 'sqlite', packages: pkgs })

  it('config/database.ts selects the native engine (engine: native + sqlite)', () => {
    const cfg = getTemplates(nativeCtx())['config/database.ts']!
    assert.ok(cfg.includes("engine: 'native' as const"))
    assert.ok(cfg.includes("driver: 'sqlite' as const"))
    assert.ok(cfg.includes("Env.get('DATABASE_URL', 'file:./dev.db')"))
  })

  it('adds @rudderjs/orm + better-sqlite3, but no adapter package / prisma', () => {
    const pkg = JSON.parse(getTemplates(nativeCtx())['package.json']!)
    assert.ok('@rudderjs/orm' in pkg.dependencies)
    assert.ok('better-sqlite3' in pkg.dependencies)
    assert.ok(!('@rudderjs/orm-prisma' in pkg.dependencies))
    assert.ok(!('@rudderjs/orm-drizzle' in pkg.dependencies))
    assert.ok(!('@prisma/client' in pkg.dependencies))
    assert.ok(!('prisma' in pkg.devDependencies))
  })

  it('scaffolds no prisma schema files', () => {
    const files = getTemplates(nativeCtx())
    assert.ok(!('prisma.config.ts' in files))
    assert.ok(!('prisma/schema/base.prisma' in files))
    assert.ok(!('prisma/schema/auth.prisma' in files))
  })

  it('auth selected → scaffolds a starter users migration', () => {
    const files = getTemplates(nativeCtx({ ...noPkgs, auth: true }))
    const path = 'database/migrations/0001_01_01_000000_create_users_table.ts'
    assert.ok(path in files)
    const mig = files[path]!
    assert.ok(mig.includes("from '@rudderjs/orm/native'"))
    assert.ok(mig.includes("Schema.create('users'"))
    assert.ok(mig.includes("t.string('email').unique()"))
    assert.ok(mig.includes("Schema.create('password_reset_tokens'"))
    assert.ok(mig.includes("Schema.dropIfExists('users')"))
  })

  it('no auth → no migration scaffolded', () => {
    const files = getTemplates(nativeCtx({ ...noPkgs }))
    assert.ok(!('database/migrations/0001_01_01_000000_create_users_table.ts' in files))
  })

  it('User model uses the SQL table name + integer id', () => {
    const model = getTemplates(nativeCtx({ ...noPkgs, auth: true }))['app/Models/User.ts']!
    assert.ok(model.includes("static table = 'users'"))
    assert.ok(model.includes('id!:              number'))
  })

  it('migrate scripts present (migrate / db:seed)', () => {
    const pkg = JSON.parse(getTemplates(nativeCtx())['package.json']!)
    assert.ok('migrate' in pkg.scripts)
    assert.ok('db:seed' in pkg.scripts)
  })

  it('.env carries the sqlite DATABASE_URL', () => {
    assert.ok(getTemplates(nativeCtx())['.env']!.includes('DATABASE_URL="file:./dev.db"'))
  })

  it('providers.ts still delegates to defaultProviders() (native provider auto-discovered)', () => {
    const providers = getTemplates(nativeCtx())['bootstrap/providers.ts']!
    assert.ok(providers.includes('defaultProviders'))
  })
})

// ─── native engine — pg / mysql drivers (7.9) ───────────────

describe('getTemplates() — native engine on pg/mysql', () => {
  const pgCtx    = ctx({ orm: 'native', db: 'postgresql' })
  const mysqlCtx = ctx({ orm: 'native', db: 'mysql' })

  it('pg: config/database.ts uses the native driver name `pg`, not `postgresql`', () => {
    const cfg = getTemplates(pgCtx)['config/database.ts']!
    assert.ok(cfg.includes("engine: 'native' as const"))
    assert.ok(cfg.includes("driver: 'pg' as const"))
    assert.ok(!cfg.includes("driver: 'postgresql'"), 'native rejects the prisma-style driver name')
    assert.ok(cfg.includes("Env.get('DB_CONNECTION', 'pg')"))
    assert.ok(cfg.includes("Env.get('DATABASE_URL', '')"))
  })

  it('mysql: config/database.ts uses the native driver name `mysql`', () => {
    const cfg = getTemplates(mysqlCtx)['config/database.ts']!
    assert.ok(cfg.includes("engine: 'native' as const"))
    assert.ok(cfg.includes("driver: 'mysql' as const"))
    assert.ok(cfg.includes("Env.get('DB_CONNECTION', 'mysql')"))
  })

  it('pg: adds the postgres driver, drops better-sqlite3', () => {
    const pkg = JSON.parse(getTemplates(pgCtx)['package.json']!)
    assert.ok('postgres' in pkg.dependencies)
    assert.ok(!('better-sqlite3' in pkg.dependencies))
    assert.ok(!('mysql2' in pkg.dependencies))
    assert.ok(!('@types/better-sqlite3' in pkg.devDependencies))
  })

  it('mysql: adds the mysql2 driver, drops better-sqlite3', () => {
    const pkg = JSON.parse(getTemplates(mysqlCtx)['package.json']!)
    assert.ok('mysql2' in pkg.dependencies)
    assert.ok(!('better-sqlite3' in pkg.dependencies))
    assert.ok(!('postgres' in pkg.dependencies))
  })

  it('pg/mysql: .env carries the matching DATABASE_URL scheme', () => {
    assert.ok(getTemplates(pgCtx)['.env']!.includes('DATABASE_URL="postgresql://'))
    assert.ok(getTemplates(mysqlCtx)['.env']!.includes('DATABASE_URL="mysql://'))
  })

  it('pg/mysql: the dialect-agnostic users migration is scaffolded unchanged', () => {
    const path = 'database/migrations/0001_01_01_000000_create_users_table.ts'
    const pg    = getTemplates(pgCtx)[path]!
    const mysql = getTemplates(mysqlCtx)[path]!
    assert.equal(pg, mysql, 'blueprint is dialect-agnostic — same file on every driver')
    assert.ok(pg.includes("Schema.create('users'"))
  })

  it('pg/mysql: no postinstall allowlist entries needed (postgres/mysql2 have no build scripts)', () => {
    const pg = getTemplates(pgCtx)['pnpm-workspace.yaml']!
    // dangerouslyAllowAllBuilds stays (esbuild), but nothing driver-specific is required
    assert.ok(pg.includes('dangerouslyAllowAllBuilds: true'))
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
    // vikejs/vike#3251 is fixed in vike core; vike-react 0.6.23, vike-vue
    // 0.9.11, and vike-solid 0.8.2 all use plain `satisfies Config` in
    // their example `+config.ts` under `exactOptionalPropertyTypes: true`.
    assert.ok(config.includes('satisfies Config'))
    assert.ok(!config.includes('as unknown as Config'))
  })
})

// ─── log + hash configs ──────────────────────────────────

describe('getTemplates() — log and hash configs', () => {
  it('config/log.ts always generated', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok('config/log.ts' in files)
    assert.ok(files['config/log.ts']!.includes('LogConfig'))
  })

  it('config/hash.ts always generated (Tier A)', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok('config/hash.ts' in files)
    assert.ok(files['config/hash.ts']!.includes('HashConfig'))
  })

  it('@rudderjs/log always in base deps', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/log' in pkg.dependencies)
  })

  it('@rudderjs/hash always in deps (Tier A)', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
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

  it('config/index.ts always includes hash (Tier A)', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok(files['config/index.ts']!.includes("from './hash.js'"))
  })
})

// ─── WebContainer-aware config defaults ──────────────────
//
// Each of cache/queue/mail/session has an `isWebContainer()` gate that
// short-circuits the env-driven default to a sandbox-safe driver. On regular
// Node the gate returns false and the env path is preserved; only the gate
// presence is asserted here.

describe('getTemplates() — WebContainer-aware config defaults', () => {
  it('config/cache.ts gates default store on isWebContainer()', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    const cache = files['config/cache.ts']!
    assert.ok(cache.includes("import { Env, isWebContainer } from '@rudderjs/support'"))
    assert.ok(cache.includes("isWebContainer() ? 'memory'"))
  })

  it('config/queue.ts gates default connection on isWebContainer()', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, queue: true } }))
    const queue = files['config/queue.ts']!
    assert.ok(queue.includes("import { Env, isWebContainer } from '@rudderjs/support'"))
    assert.ok(queue.includes("isWebContainer() ? 'sync'"))
  })

  it('config/mail.ts gates default mailer on isWebContainer()', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, mail: true } }))
    const mail = files['config/mail.ts']!
    assert.ok(mail.includes("import { Env, isWebContainer } from '@rudderjs/support'"))
    assert.ok(mail.includes("isWebContainer() ? 'log'"))
  })

  it('config/session.ts pins driver to cookie under isWebContainer()', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, auth: true } }))
    const session = files['config/session.ts']!
    assert.ok(session.includes("import { Env, isWebContainer } from '@rudderjs/support'"))
    assert.ok(session.includes("isWebContainer()"))
    assert.ok(session.includes("'cookie'"))
  })
})

// ─── sync config ──────────────────────────────────────────

describe('getTemplates() — sync config wiring', () => {
  it('sync selected → config/sync.ts generated and wired into config/index.ts', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, sync: true } }))
    assert.ok('config/sync.ts' in files)
    assert.ok(files['config/sync.ts']!.includes('SyncConfig'))
    assert.ok(files['config/index.ts']!.includes("from './sync.js'"))
  })

  it('sync + prisma → syncPrisma() persistence', () => {
    const files = getTemplates(ctx({ orm: 'prisma', packages: { ...noPkgs, sync: true } }))
    assert.ok(files['config/sync.ts']!.includes('syncPrisma'))
  })

  it('sync not selected → no config/sync.ts, no sync import in config/index.ts', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok(!('config/sync.ts' in files))
    assert.ok(!files['config/index.ts']!.includes("from './sync.js'"))
  })

  it('sync selected → @rudderjs/sync in deps', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, sync: true } }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/sync' in pkg.dependencies)
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

// ─── telescope package ───────────────────────────────────

describe('getTemplates() — telescope package', () => {
  it('telescope selected → @rudderjs/telescope in deps + config/telescope.ts generated', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, telescope: true } }))
    assert.ok('config/telescope.ts' in files)
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/telescope' in pkg.dependencies)
    assert.ok(files['config/telescope.ts']!.includes('TelescopeConfig'))
    assert.ok(files['config/telescope.ts']!.includes("storage:            'memory'"))
  })

  it('telescope selected → config/index.ts imports + exports telescope', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, telescope: true } }))
    const idx = files['config/index.ts']!
    assert.ok(idx.includes("from './telescope.js'"))
    assert.ok(idx.includes('telescope'))
  })

  it('telescope not selected → no config/telescope.ts, no dep', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    assert.ok(!('config/telescope.ts' in files))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!('@rudderjs/telescope' in pkg.dependencies))
    assert.ok(!files['config/index.ts']!.includes("from './telescope.js'"))
  })
})

// ─── new Phase 2 packages ────────────────────────────────

describe('getTemplates() — Phase 2 new packages', () => {
  const cases: Array<{ key: keyof TemplateContext['packages']; dep: string; configFile?: string }> = [
    { key: 'sanctum',       dep: '@rudderjs/sanctum',        configFile: 'config/sanctum.ts' },
    { key: 'socialite',     dep: '@rudderjs/socialite',      configFile: 'config/socialite.ts' },
    { key: 'pulse',         dep: '@rudderjs/pulse',          configFile: 'config/pulse.ts' },
    { key: 'horizon',       dep: '@rudderjs/horizon',        configFile: 'config/horizon.ts' },
    { key: 'crypt',         dep: '@rudderjs/crypt',          configFile: 'config/crypt.ts' },
    { key: 'pennant',       dep: '@rudderjs/pennant',        configFile: 'config/pennant.ts' },
    { key: 'image',         dep: '@rudderjs/image' },
    { key: 'http',          dep: '@rudderjs/http' },
    { key: 'process',       dep: '@rudderjs/process' },
    { key: 'concurrency',   dep: '@rudderjs/concurrency' },
  ]

  for (const { key, dep, configFile } of cases) {
    it(`${key} selected → ${dep} in deps${configFile ? ` + ${configFile}` : ''}`, () => {
      const files = getTemplates(ctx({ packages: { ...noPkgs, [key]: true } }))
      const pkg = JSON.parse(files['package.json']!)
      assert.ok(dep in pkg.dependencies, `${dep} must be in dependencies`)
      if (configFile) {
        assert.ok(configFile in files, `${configFile} must be generated`)
        assert.ok(files['config/index.ts']!.includes(`from './${configFile.split('/')[1]!.replace('.ts', '.js')}'`),
          `${configFile} must be wired in config/index.ts`)
      }
    })

    it(`${key} not selected → ${dep} not in deps`, () => {
      const files = getTemplates(ctx({ packages: noPkgs }))
      const pkg = JSON.parse(files['package.json']!)
      assert.ok(!(dep in pkg.dependencies))
      if (configFile) assert.ok(!(configFile in files))
    })
  }

  it('crypt selected → APP_KEY emitted in .env', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, crypt: true }, appKey: 'test-key' }))
    assert.ok(files['.env']!.includes('APP_KEY=base64:test-key'))
    assert.ok(files['.env.example']!.includes('APP_KEY='))
  })

  it('socialite selected → GitHub + Google env keys emitted', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, socialite: true } }))
    assert.ok(files['.env']!.includes('GITHUB_CLIENT_ID='))
    assert.ok(files['.env']!.includes('GOOGLE_CLIENT_ID='))
  })

})

// ─── boost package ───────────────────────────────────────

describe('getTemplates() — boost package', () => {
  it('boost selected → @rudderjs/boost in devDependencies (not dependencies)', () => {
    const files = getTemplates(ctx({ packages: { ...noPkgs, boost: true } }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok('@rudderjs/boost' in pkg.devDependencies)
    assert.ok(!('@rudderjs/boost' in pkg.dependencies))
  })

  it('boost not selected → @rudderjs/boost not in deps or devDeps', () => {
    const files = getTemplates(ctx({ packages: noPkgs }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(!('@rudderjs/boost' in pkg.dependencies))
    assert.ok(!('@rudderjs/boost' in pkg.devDependencies))
  })
})

// ─── demos package ───────────────────────────────────────

describe('getTemplates() — demos dropped from scaffolder', () => {
  // The scaffolder no longer ships /demos/* — every demo lives in the
  // playground app instead. These tests pin the absence so a future regression
  // (re-importing demo templates, re-adding /demos routes) fails loudly.
  it('default React + auth profile scaffolds no Demos views', () => {
    const files = getTemplates(ctx({ packages: defaultPkgs }))
    for (const filename of Object.keys(files)) {
      assert.ok(!filename.startsWith('app/Views/Demos/'), `scaffolder shouldn't ship demo view "${filename}"`)
      assert.ok(!filename.startsWith('app/Modules/Todo/'), `scaffolder shouldn't ship the todos demo module "${filename}"`)
    }
  })

  it('routes/web.ts has no demo URLs', () => {
    const files = getTemplates(ctx({ packages: defaultPkgs }))
    assert.ok(!files['routes/web.ts']!.includes("/demos"), 'routes/web.ts should not register any /demos routes')
    assert.ok(!files['routes/web.ts']!.includes("view('demos."), "routes/web.ts should not call view('demos.*')")
  })

  it('routes/api.ts has no demo endpoints (other than /api/health)', () => {
    const files = getTemplates(ctx({ packages: defaultPkgs }))
    const api = files['routes/api.ts']!
    for (const url of ['/api/contact', '/api/ws/broadcast', '/api/fib', '/api/avatar', '/api/queue/dispatch', '/api/mail/send', '/api/notifications/send', '/api/i18n', '/api/http/fetch', '/api/polymorphic']) {
      assert.ok(!api.includes(url), `routes/api.ts should not include demo endpoint "${url}"`)
    }
  })

  it('SiteHeader has no "Demos" nav link', () => {
    const files = getTemplates(ctx({ packages: defaultPkgs }))
    const header = files[`app/Components/SiteHeader.tsx`]!
    assert.ok(header, 'SiteHeader.tsx should exist for react primary')
    assert.ok(!header.includes('"/demos"'), 'SiteHeader should not link to /demos')
    assert.ok(!header.includes('>Demos<'), 'SiteHeader should not show the "Demos" label')
  })

  it('modules.prisma is just the empty marker block (no preloaded demo models)', () => {
    const files = getTemplates(ctx({ packages: defaultPkgs }))
    const schema = files['prisma/schema/modules.prisma']!
    assert.ok(schema.includes('<rudderjs:modules:start>'))
    assert.ok(schema.includes('<rudderjs:modules:end>'))
    assert.ok(!schema.includes('model Todo'),    'modules.prisma should not preload the todos demo model')
    assert.ok(!schema.includes('model Post'),    'modules.prisma should not preload polymorphic demo models')
    assert.ok(!schema.includes('model Comment'), 'modules.prisma should not preload polymorphic demo models')
    assert.ok(!schema.includes('model Tag'),     'modules.prisma should not preload polymorphic demo models')
  })
})
