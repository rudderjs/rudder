import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import nodePath from 'node:path'
import os from 'node:os'

import { stub as controllerStub, derivePrefix } from './commands/make/controller.js'
import { stub as modelStub, deriveTable } from './commands/make/model.js'
import { stub as jobStub } from './commands/make/job.js'
import { stub as middlewareStub } from './commands/make/middleware.js'
import { stub as requestStub } from './commands/make/request.js'
import { stub as providerStub } from './commands/make/provider.js'
import { stub as commandStub } from './commands/make/command.js'
import { stub as eventStub } from './commands/make/event.js'
import { stub as listenerStub } from './commands/make/listener.js'
import { stub as mailStub } from './commands/make/mail.js'
import {
  schemaStub,
  serviceStub,
  providerStub as moduleProviderStub,
  testStub,
  prismaStub,
  autoRegisterProvider,
} from './commands/module/make.js'
import { MARKERS_RE, findPrismaFiles, buildMergedBlock } from './commands/module/publish.js'

// ─── make:controller ───────────────────────────────────────

describe('make:controller — derivePrefix()', () => {
  it('UserController → /users', () => {
    assert.strictEqual(derivePrefix('UserController'), '/users')
  })

  it('BlogPostController → /blog-posts', () => {
    assert.strictEqual(derivePrefix('BlogPostController'), '/blog-posts')
  })

  it('ProductController → /products', () => {
    assert.strictEqual(derivePrefix('ProductController'), '/products')
  })
})

describe('make:controller — stub()', () => {
  it('contains class name', () => {
    const out = controllerStub('UserController', '/users')
    assert.ok(out.includes('class UserController'))
  })

  it('contains prefix in @Controller decorator', () => {
    const out = controllerStub('UserController', '/users')
    assert.ok(out.includes("@Controller('/users')"))
  })

  it('imports Controller and Get from @boostkit/router', () => {
    const out = controllerStub('UserController', '/users')
    assert.ok(out.includes("from '@boostkit/router'"))
  })
})

// ─── make:model ────────────────────────────────────────────

describe('make:model — deriveTable()', () => {
  it('User → users', () => {
    assert.strictEqual(deriveTable('User'), 'users')
  })

  it('BlogPost → blog_posts', () => {
    assert.strictEqual(deriveTable('BlogPost'), 'blog_posts')
  })

  it('OrderItem → order_items', () => {
    assert.strictEqual(deriveTable('OrderItem'), 'order_items')
  })
})

describe('make:model — stub()', () => {
  it('contains class name', () => {
    const out = modelStub('User', 'users')
    assert.ok(out.includes('class User extends Model'))
  })

  it('sets static table', () => {
    const out = modelStub('User', 'users')
    assert.ok(out.includes("static table = 'users'"))
  })

  it('imports Model from @boostkit/orm', () => {
    const out = modelStub('User', 'users')
    assert.ok(out.includes("from '@boostkit/orm'"))
  })
})

// ─── make:job ──────────────────────────────────────────────

describe('make:job — stub()', () => {
  it('contains class name', () => {
    const out = jobStub('SendWelcomeEmail')
    assert.ok(out.includes('class SendWelcomeEmail extends Job'))
  })

  it('contains async handle()', () => {
    const out = jobStub('SendWelcomeEmail')
    assert.ok(out.includes('async handle()'))
  })

  it('imports Job from @boostkit/queue', () => {
    const out = jobStub('SendWelcomeEmail')
    assert.ok(out.includes("from '@boostkit/queue'"))
  })
})

// ─── make:middleware ────────────────────────────────────────

describe('make:middleware — stub()', () => {
  it('contains class name', () => {
    const out = middlewareStub('AuthMiddleware')
    assert.ok(out.includes('class AuthMiddleware extends Middleware'))
  })

  it('imports Middleware from @boostkit/middleware', () => {
    const out = middlewareStub('AuthMiddleware')
    assert.ok(out.includes("from '@boostkit/middleware'"))
  })

  it('contains next() call', () => {
    const out = middlewareStub('AuthMiddleware')
    assert.ok(out.includes('await next()'))
  })
})

// ─── make:request ──────────────────────────────────────────

describe('make:request — stub()', () => {
  it('contains class name', () => {
    const out = requestStub('CreateUserRequest')
    assert.ok(out.includes('class CreateUserRequest extends FormRequest'))
  })

  it('contains authorize() method', () => {
    const out = requestStub('CreateUserRequest')
    assert.ok(out.includes('authorize()'))
  })

  it('imports z from @boostkit/core', () => {
    const out = requestStub('CreateUserRequest')
    assert.ok(out.includes("from '@boostkit/core'"))
  })
})

// ─── make:provider ─────────────────────────────────────────

describe('make:provider — stub()', () => {
  it('contains class name', () => {
    const out = providerStub('AppServiceProvider')
    assert.ok(out.includes('class AppServiceProvider extends ServiceProvider'))
  })

  it('contains register() method', () => {
    const out = providerStub('AppServiceProvider')
    assert.ok(out.includes('register()'))
  })

  it('imports ServiceProvider from @boostkit/core', () => {
    const out = providerStub('AppServiceProvider')
    assert.ok(out.includes("from '@boostkit/core'"))
  })
})

// ─── make:command ──────────────────────────────────────────

describe('make:command — stub()', () => {
  it('contains class name', () => {
    const out = commandStub('SendEmails')
    assert.ok(out.includes('class SendEmails extends Command'))
  })

  it('converts PascalCase to kebab-case signature', () => {
    const out = commandStub('SendEmails')
    assert.ok(out.includes("'send-emails"))
  })

  it('imports Command from @boostkit/artisan', () => {
    const out = commandStub('SendEmails')
    assert.ok(out.includes("from '@boostkit/artisan'"))
  })

  it('single word command stays lowercase', () => {
    const out = commandStub('Seed')
    assert.ok(out.includes("'seed"))
  })
})

// ─── make:event ────────────────────────────────────────────

describe('make:event — stub()', () => {
  it('contains class name', () => {
    const out = eventStub('UserRegistered')
    assert.ok(out.includes('class UserRegistered'))
  })

  it('has a constructor', () => {
    const out = eventStub('UserRegistered')
    assert.ok(out.includes('constructor('))
  })
})

// ─── make:listener ─────────────────────────────────────────

describe('make:listener — stub()', () => {
  it('contains class name', () => {
    const out = listenerStub('SendWelcomeEmailListener')
    assert.ok(out.includes('class SendWelcomeEmailListener implements Listener'))
  })

  it('contains async handle()', () => {
    const out = listenerStub('SendWelcomeEmailListener')
    assert.ok(out.includes('async handle('))
  })

  it('imports Listener from @boostkit/core', () => {
    const out = listenerStub('SendWelcomeEmailListener')
    assert.ok(out.includes("from '@boostkit/core'"))
  })
})

// ─── make:mail ─────────────────────────────────────────────

describe('make:mail — stub()', () => {
  it('contains class name', () => {
    const out = mailStub('WelcomeMail')
    assert.ok(out.includes('class WelcomeMail extends Mailable'))
  })

  it('contains build() method', () => {
    const out = mailStub('WelcomeMail')
    assert.ok(out.includes('build()'))
  })

  it('imports Mailable from @boostkit/mail', () => {
    const out = mailStub('WelcomeMail')
    assert.ok(out.includes("from '@boostkit/mail'"))
  })
})

// ─── module/make stubs ─────────────────────────────────────

describe('schemaStub()', () => {
  it('generates InputSchema and OutputSchema', () => {
    const out = schemaStub('Product')
    assert.ok(out.includes('ProductInputSchema'))
    assert.ok(out.includes('ProductOutputSchema'))
  })

  it('exports ProductInput type', () => {
    const out = schemaStub('Product')
    assert.ok(out.includes('export type ProductInput'))
  })

  it('imports z from zod', () => {
    const out = schemaStub('Product')
    assert.ok(out.includes("from 'zod'"))
  })
})

describe('serviceStub()', () => {
  it('contains service class', () => {
    const out = serviceStub('Product')
    assert.ok(out.includes('class ProductService'))
  })

  it('has findAll, findById, create methods', () => {
    const out = serviceStub('Product')
    assert.ok(out.includes('findAll()'))
    assert.ok(out.includes('findById('))
    assert.ok(out.includes('create('))
  })

  it('has @Injectable decorator', () => {
    const out = serviceStub('Product')
    assert.ok(out.includes('@Injectable()'))
  })
})

describe('moduleProviderStub()', () => {
  it('contains service provider class', () => {
    const out = moduleProviderStub('Product')
    assert.ok(out.includes('class ProductServiceProvider extends ServiceProvider'))
  })

  it('derives kebab-case API prefix', () => {
    const out = moduleProviderStub('Product')
    assert.ok(out.includes('/api/products'))
  })

  it('BlogPost derives /api/blog-posts', () => {
    const out = moduleProviderStub('BlogPost')
    assert.ok(out.includes('/api/blog-posts'))
  })
})

describe('testStub()', () => {
  it('contains describe block for the name', () => {
    const out = testStub('Product')
    assert.ok(out.includes("describe('Product'"))
  })

  it('validates valid input and rejects empty name', () => {
    const out = testStub('Product')
    assert.ok(out.includes('validates a valid input'))
    assert.ok(out.includes('rejects an empty name'))
  })
})

describe('prismaStub()', () => {
  it('creates a model block', () => {
    const out = prismaStub('Product')
    assert.ok(out.includes('model Product {'))
  })

  it('includes id, createdAt, updatedAt', () => {
    const out = prismaStub('Product')
    assert.ok(out.includes('@id'))
    assert.ok(out.includes('createdAt'))
    assert.ok(out.includes('updatedAt'))
  })
})

// ─── module/publish helpers ────────────────────────────────

describe('MARKERS_RE', () => {
  it('matches a markers block', () => {
    const text = '// <boostkit:modules:start>\nmodel Foo {}\n// <boostkit:modules:end>'
    assert.ok(MARKERS_RE.test(text))
  })

  it('does not match partial markers', () => {
    const text = '// <boostkit:modules:start>\nmodel Foo {}'
    assert.ok(!MARKERS_RE.test(text))
  })
})

describe('buildMergedBlock()', () => {
  it('wraps shards in markers', () => {
    const shards = [{ module: 'Blog', file: 'Blog.prisma', content: 'model Blog {}' }]
    const out = buildMergedBlock(shards)
    assert.ok(out.startsWith('// <boostkit:modules:start>'))
    assert.ok(out.endsWith('// <boostkit:modules:end>'))
  })

  it('annotates each shard with module and file name', () => {
    const shards = [{ module: 'Blog', file: 'Blog.prisma', content: 'model Blog {}' }]
    const out = buildMergedBlock(shards)
    assert.ok(out.includes('// module: Blog (Blog.prisma)'))
    assert.ok(out.includes('model Blog {}'))
  })

  it('joins multiple shards with blank lines', () => {
    const shards = [
      { module: 'A', file: 'A.prisma', content: 'model A {}' },
      { module: 'B', file: 'B.prisma', content: 'model B {}' },
    ]
    const out = buildMergedBlock(shards)
    assert.ok(out.includes('model A {}'))
    assert.ok(out.includes('model B {}'))
  })

  it('re-replaced by MARKERS_RE', () => {
    const shards = [{ module: 'X', file: 'X.prisma', content: 'model X {}' }]
    const block = buildMergedBlock(shards)
    const schema = `datasource db {}\n\n${block}\n`
    assert.ok(MARKERS_RE.test(schema))
    const replaced = schema.replace(MARKERS_RE, '// replaced')
    assert.ok(replaced.includes('// replaced'))
    assert.ok(!replaced.includes('model X {}'))
  })
})

describe('findPrismaFiles()', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'boostkit-cli-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array when modulesDir does not exist', async () => {
    const results = await findPrismaFiles(nodePath.join(tmpDir, 'nonexistent'))
    assert.deepStrictEqual(results, [])
  })

  it('finds .prisma files in module subdirectories', async () => {
    const blogDir = nodePath.join(tmpDir, 'Blog')
    await fs.mkdir(blogDir)
    await fs.writeFile(nodePath.join(blogDir, 'Blog.prisma'), 'model Blog {}')

    const results = await findPrismaFiles(tmpDir)
    assert.strictEqual(results.length, 1)
    assert.strictEqual(results[0]!.module, 'Blog')
    assert.strictEqual(results[0]!.file, 'Blog.prisma')
    assert.ok(results[0]!.content.includes('model Blog {}'))
  })

  it('ignores non-.prisma files', async () => {
    const blogDir = nodePath.join(tmpDir, 'Blog')
    await fs.mkdir(blogDir)
    await fs.writeFile(nodePath.join(blogDir, 'Blog.ts'), 'export class Blog {}')
    await fs.writeFile(nodePath.join(blogDir, 'Blog.prisma'), 'model Blog {}')

    const results = await findPrismaFiles(tmpDir)
    assert.strictEqual(results.length, 1)
  })

  it('filters by moduleFilter when specified', async () => {
    const blogDir = nodePath.join(tmpDir, 'Blog')
    const userDir = nodePath.join(tmpDir, 'User')
    await fs.mkdir(blogDir)
    await fs.mkdir(userDir)
    await fs.writeFile(nodePath.join(blogDir, 'Blog.prisma'), 'model Blog {}')
    await fs.writeFile(nodePath.join(userDir, 'User.prisma'), 'model User {}')

    const results = await findPrismaFiles(tmpDir, 'Blog')
    assert.strictEqual(results.length, 1)
    assert.strictEqual(results[0]!.module, 'Blog')
  })

  it('finds multiple .prisma files across modules', async () => {
    const blogDir = nodePath.join(tmpDir, 'Blog')
    const userDir = nodePath.join(tmpDir, 'User')
    await fs.mkdir(blogDir)
    await fs.mkdir(userDir)
    await fs.writeFile(nodePath.join(blogDir, 'Blog.prisma'), 'model Blog {}')
    await fs.writeFile(nodePath.join(userDir, 'User.prisma'), 'model User {}')

    const results = await findPrismaFiles(tmpDir)
    assert.strictEqual(results.length, 2)
  })
})

// ─── autoRegisterProvider ──────────────────────────────────

describe('autoRegisterProvider()', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'boostkit-cli-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('creates bootstrap/providers.ts when it does not exist', async () => {
    await autoRegisterProvider('Blog', tmpDir)
    const content = await fs.readFile(nodePath.join(tmpDir, 'bootstrap', 'providers.ts'), 'utf8')
    assert.ok(content.includes('BlogServiceProvider'))
  })

  it('skips registration when provider is already present', async () => {
    const bootstrapDir = nodePath.join(tmpDir, 'bootstrap')
    await fs.mkdir(bootstrapDir)
    const existing = `import { BlogServiceProvider } from '../app/Modules/Blog/BlogServiceProvider.js'

export const providers: any[] = [BlogServiceProvider]
`
    await fs.writeFile(nodePath.join(bootstrapDir, 'providers.ts'), existing)

    await autoRegisterProvider('Blog', tmpDir)

    const content = await fs.readFile(nodePath.join(bootstrapDir, 'providers.ts'), 'utf8')
    assert.strictEqual(content, existing)
  })

  it('adds import when file exists without the provider', async () => {
    const bootstrapDir = nodePath.join(tmpDir, 'bootstrap')
    await fs.mkdir(bootstrapDir)
    await fs.writeFile(
      nodePath.join(bootstrapDir, 'providers.ts'),
      `import type { ServiceProvider } from '@boostkit/core'\n\nexport const providers: any[] = []\n`
    )

    await autoRegisterProvider('Product', tmpDir)

    const content = await fs.readFile(nodePath.join(bootstrapDir, 'providers.ts'), 'utf8')
    assert.ok(content.includes('ProductServiceProvider'))
  })
})

// ─── migrate commands ─────────────────────────────────────

import { detectORM, buildArgs } from './commands/migrate.js'

describe('migrate — detectORM()', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'bk-migrate-'))
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('returns "prisma" when @boostkit/orm-prisma is in dependencies', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@boostkit/orm-prisma': 'latest' },
    }))
    assert.equal(detectORM(tmpDir), 'prisma')
  })

  it('returns "drizzle" when @boostkit/orm-drizzle is in dependencies', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@boostkit/orm-drizzle': 'latest' },
    }))
    assert.equal(detectORM(tmpDir), 'drizzle')
  })

  it('returns "prisma" when @boostkit/orm-prisma is in devDependencies', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      devDependencies: { '@boostkit/orm-prisma': 'latest' },
    }))
    assert.equal(detectORM(tmpDir), 'prisma')
  })

  it('returns null when neither ORM is present', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { 'express': '4.0.0' },
    }))
    assert.equal(detectORM(tmpDir), null)
  })

  it('returns null when package.json does not exist', () => {
    assert.equal(detectORM(nodePath.join(tmpDir, 'nonexistent')), null)
  })

  it('prefers prisma when both ORMs are listed', async () => {
    await fs.writeFile(nodePath.join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@boostkit/orm-prisma': 'latest', '@boostkit/orm-drizzle': 'latest' },
    }))
    assert.equal(detectORM(tmpDir), 'prisma')
  })
})

describe('migrate — buildArgs()', () => {
  // ── Prisma ──────────────────────────────────────────────

  it('prisma migrate (dev)', () => {
    const args = buildArgs('prisma', 'migrate', { env: 'development' })
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'dev'])
  })

  it('prisma migrate (production)', () => {
    const args = buildArgs('prisma', 'migrate', { env: 'production' })
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'deploy'])
  })

  it('prisma migrate:fresh', () => {
    const args = buildArgs('prisma', 'migrate:fresh')
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'reset', '--force'])
  })

  it('prisma migrate:status', () => {
    const args = buildArgs('prisma', 'migrate:status')
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'status'])
  })

  it('prisma make:migration with name', () => {
    const args = buildArgs('prisma', 'make:migration', { name: 'add-users' })
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'dev', '--create-only', '--name', 'add-users'])
  })

  it('prisma make:migration uses default name', () => {
    const args = buildArgs('prisma', 'make:migration')
    assert.deepEqual(args, ['exec', 'prisma', 'migrate', 'dev', '--create-only', '--name', 'migration'])
  })

  it('prisma db:push', () => {
    const args = buildArgs('prisma', 'db:push')
    assert.deepEqual(args, ['exec', 'prisma', 'db', 'push'])
  })

  it('prisma db:generate', () => {
    const args = buildArgs('prisma', 'db:generate')
    assert.deepEqual(args, ['exec', 'prisma', 'generate'])
  })

  // ── Drizzle ─────────────────────────────────────────────

  it('drizzle migrate', () => {
    const args = buildArgs('drizzle', 'migrate')
    assert.deepEqual(args, ['exec', 'drizzle-kit', 'migrate'])
  })

  it('drizzle migrate:fresh', () => {
    const args = buildArgs('drizzle', 'migrate:fresh')
    assert.deepEqual(args, ['exec', 'drizzle-kit', 'migrate', '--force'])
  })

  it('drizzle migrate:status', () => {
    const args = buildArgs('drizzle', 'migrate:status')
    assert.deepEqual(args, ['exec', 'drizzle-kit', 'check'])
  })

  it('drizzle make:migration with name', () => {
    const args = buildArgs('drizzle', 'make:migration', { name: 'add-posts' })
    assert.deepEqual(args, ['exec', 'drizzle-kit', 'generate', '--name', 'add-posts'])
  })

  it('drizzle db:push', () => {
    const args = buildArgs('drizzle', 'db:push')
    assert.deepEqual(args, ['exec', 'drizzle-kit', 'push'])
  })

  it('drizzle db:generate returns empty (no-op)', () => {
    const args = buildArgs('drizzle', 'db:generate')
    assert.deepEqual(args, [])
  })
})
