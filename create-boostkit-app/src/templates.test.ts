import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getTemplates, type TemplateContext } from './templates.js'

// ─── Helpers ───────────────────────────────────────────────

function ctx(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    name:       'my-app',
    db:         'sqlite',
    withTodo:   false,
    authSecret: 'test-secret',
    frameworks: ['react'],
    primary:    'react',
    tailwind:   true,
    shadcn:     false,
    ...overrides,
  }
}

// ─── File set ──────────────────────────────────────────────

describe('getTemplates() — core files always present', () => {
  const files = getTemplates(ctx())

  it('generates package.json', () => assert.ok('package.json' in files))
  it('generates pnpm-workspace.yaml', () => assert.ok('pnpm-workspace.yaml' in files))
  it('generates tsconfig.json', () => assert.ok('tsconfig.json' in files))
  it('generates vite.config.ts', () => assert.ok('vite.config.ts' in files))
  it('generates .env', () => assert.ok('.env' in files))
  it('generates .env.example', () => assert.ok('.env.example' in files))
  it('generates .gitignore', () => assert.ok('.gitignore' in files))
  it('generates prisma/schema.prisma', () => assert.ok('prisma/schema.prisma' in files))
  it('generates bootstrap/app.ts', () => assert.ok('bootstrap/app.ts' in files))
  it('generates bootstrap/providers.ts', () => assert.ok('bootstrap/providers.ts' in files))
  it('generates routes/api.ts', () => assert.ok('routes/api.ts' in files))
  it('generates routes/web.ts', () => assert.ok('routes/web.ts' in files))
  it('generates routes/console.ts', () => assert.ok('routes/console.ts' in files))
  it('generates config/index.ts', () => assert.ok('config/index.ts' in files))
  it('generates app/Models/User.ts', () => assert.ok('app/Models/User.ts' in files))
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
    assert.ok(files['prisma/schema.prisma']!.includes('model Todo {'))
  })

  it('prisma schema does not include Todo model when withTodo=false', () => {
    const files = getTemplates(ctx({ withTodo: false }))
    assert.ok(!files['prisma/schema.prisma']!.includes('model Todo {'))
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

  it('includes better-sqlite3 in onlyBuiltDependencies for sqlite', () => {
    const files = getTemplates(ctx({ db: 'sqlite' }))
    const pkg = JSON.parse(files['package.json']!)
    assert.ok(pkg.pnpm.onlyBuiltDependencies.includes('better-sqlite3'))
  })
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
    assert.ok(files['prisma/schema.prisma']!.includes('provider = "sqlite"'))
  })

  it('uses postgresql provider for postgresql db', () => {
    const files = getTemplates(ctx({ db: 'postgresql' }))
    assert.ok(files['prisma/schema.prisma']!.includes('provider = "postgresql"'))
  })

  it('uses mysql provider for mysql db', () => {
    const files = getTemplates(ctx({ db: 'mysql' }))
    assert.ok(files['prisma/schema.prisma']!.includes('provider = "mysql"'))
  })

  it('always includes User, Session, Account, Verification models', () => {
    const schema = getTemplates(ctx())['prisma/schema.prisma']!
    assert.ok(schema.includes('model User {'))
    assert.ok(schema.includes('model Session {'))
    assert.ok(schema.includes('model Account {'))
    assert.ok(schema.includes('model Verification {'))
  })

  it('includes module markers', () => {
    const schema = getTemplates(ctx())['prisma/schema.prisma']!
    assert.ok(schema.includes('// <boostkit:modules:start>'))
    assert.ok(schema.includes('// <boostkit:modules:end>'))
  })
})

// ─── .env ──────────────────────────────────────────────────

describe('getTemplates() — .env', () => {
  it('includes app name', () => {
    const files = getTemplates(ctx({ name: 'test-project' }))
    assert.ok(files['.env']!.includes('APP_NAME=test-project'))
  })

  it('includes auth secret', () => {
    const files = getTemplates(ctx({ authSecret: 'abc123' }))
    assert.ok(files['.env']!.includes('AUTH_SECRET=abc123'))
  })

  it('.env.example has placeholder secret', () => {
    const files = getTemplates(ctx({ authSecret: 'real-secret' }))
    assert.ok(!files['.env.example']!.includes('real-secret'))
    assert.ok(files['.env.example']!.includes('please-set'))
  })
})
