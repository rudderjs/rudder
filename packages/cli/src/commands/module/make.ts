import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import { intro, outro, spinner, log } from '@clack/prompts'

// ─── File stubs ────────────────────────────────────────────

function schemaStub(name: string): string {
  return `import { z } from 'zod'

export const ${name}InputSchema = z.object({
  // TODO: define input fields
  name: z.string().min(1),
})

export const ${name}OutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type ${name}Input = z.infer<typeof ${name}InputSchema>
export type ${name} = z.infer<typeof ${name}OutputSchema>
`
}

function serviceStub(name: string): string {
  return `import { Injectable } from '@forge/di'
import type { ${name}Input, ${name} } from './${name}Schema.js'

@Injectable()
export class ${name}Service {
  // TODO: inject PrismaAdapter or ORM adapter

  async findAll(): Promise<${name}[]> {
    // TODO: replace with real DB call
    return []
  }

  async findById(id: string): Promise<${name} | null> {
    // TODO: replace with real DB call
    return null
  }

  async create(input: ${name}Input): Promise<${name}> {
    // TODO: replace with real DB call
    throw new Error('Not implemented')
  }
}
`
}

function controllerStub(name: string): string {
  const prefix = `/${name.replace(/([A-Z])/g, (m, l, i) => (i === 0 ? l : `-${l}`)).toLowerCase()}s`
  return `import { Controller, Get, Post } from '@forge/router'
import type { Context } from '@forge/server'
import { ${name}Service } from './${name}Service.js'

@Controller('${prefix}')
export class ${name}Controller {
  constructor(private service: ${name}Service) {}

  @Get('/')
  async index(_ctx: Context) {
    const items = await this.service.findAll()
    return { data: items }
  }

  @Get('/:id')
  async show({ params }: Context) {
    const item = await this.service.findById(params!['id'] as string)
    if (!item) return { error: 'Not found' }
    return { data: item }
  }

  @Post('/')
  async store({ body }: Context) {
    const item = await this.service.create(body as any)
    return { data: item }
  }
}
`
}

function providerStub(name: string): string {
  return `import { ServiceProvider } from '@forge/core'
import { ${name}Controller } from './${name}Controller.js'

export class ${name}ServiceProvider extends ServiceProvider {
  register(): void {
    // Register ${name} module bindings
  }

  override async boot(): Promise<void> {
    const router = this.app.make<any>('router')
    router?.registerController(${name}Controller)
  }
}
`
}

function testStub(name: string): string {
  return `import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ${name}InputSchema } from './${name}Schema.js'

describe('${name}', () => {
  it('validates a valid input', () => {
    const result = ${name}InputSchema.safeParse({ name: 'Test' })
    assert.strictEqual(result.success, true)
  })

  it('rejects an empty name', () => {
    const result = ${name}InputSchema.safeParse({ name: '' })
    assert.strictEqual(result.success, false)
  })
})
`
}

function prismaStub(name: string): string {
  return `model ${name} {
  id        String   @id @default(cuid())
  // TODO: add fields
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`
}

// ─── Auto-registration ─────────────────────────────────────

async function autoRegisterProvider(name: string, cwd: string): Promise<void> {
  const bootstrapPath = resolve(cwd, 'bootstrap/providers.ts')
  const importLine    = `import { ${name}ServiceProvider } from '../app/Modules/${name}/${name}ServiceProvider.js'`
  const pushLine      = `  ${name}ServiceProvider,`

  const template = `import type { ServiceProvider } from '@forge/core'
import type { Application } from '@forge/core'

export const providers: (new (app: Application) => ServiceProvider)[] = []\n`

  let content: string
  if (!existsSync(bootstrapPath)) {
    await mkdir(dirname(bootstrapPath), { recursive: true })
    content = template
  } else {
    content = await readFile(bootstrapPath, 'utf8')
  }

  // Skip if already registered
  if (content.includes(`${name}ServiceProvider`)) return

  // Insert import after last existing import line
  const importMatch = content.match(/^(import [^\n]+\n)+/m)
  if (importMatch) {
    const lastImportEnd = content.lastIndexOf('\nimport ')
    const insertAt = content.indexOf('\n', lastImportEnd + 1) + 1
    content = content.slice(0, insertAt) + importLine + '\n' + content.slice(insertAt)
  } else {
    content = importLine + '\n' + content
  }

  // Insert into providers array
  content = content.replace(
    /providers:\s*\[([^\]]*)\]/s,
    (_, inner) => {
      const trimmed = inner.trimEnd()
      const comma = trimmed.length > 0 && !trimmed.endsWith(',') ? ',' : ''
      return `providers: [${trimmed}${comma}\n${pushLine}\n]`
    }
  )

  await writeFile(bootstrapPath, content)
}

// ─── Command ───────────────────────────────────────────────

export function makeModule(program: Command): void {
  program
    .command('make:module <name>')
    .description('Scaffold a new module with schema, service, controller, provider, test, and Prisma model')
    .option('-f, --force', 'Overwrite existing files')
    .action(async (name: string, opts: { force?: boolean }) => {
      intro(`Creating module: ${name}`)

      const moduleDir = resolve(process.cwd(), `app/Modules/${name}`)
      const files: Array<{ path: string; content: string }> = [
        { path: `${moduleDir}/${name}Schema.ts`,          content: schemaStub(name) },
        { path: `${moduleDir}/${name}Service.ts`,         content: serviceStub(name) },
        { path: `${moduleDir}/${name}Controller.ts`,      content: controllerStub(name) },
        { path: `${moduleDir}/${name}ServiceProvider.ts`, content: providerStub(name) },
        { path: `${moduleDir}/${name}.test.ts`,           content: testStub(name) },
        { path: `${moduleDir}/${name}.prisma`,            content: prismaStub(name) },
      ]

      const s = spinner()
      s.start('Generating files')

      await mkdir(moduleDir, { recursive: true })

      for (const file of files) {
        if (existsSync(file.path) && !opts.force) {
          s.stop('Aborted')
          log.error(`File already exists: ${file.path}\nUse --force to overwrite.`)
          process.exit(1)
        }
        await writeFile(file.path, file.content)
        log.success(`Created ${file.path.replace(process.cwd() + '/', '')}`)
      }

      s.stop('Files generated')

      const s2 = spinner()
      s2.start('Registering provider')
      try {
        await autoRegisterProvider(name, process.cwd())
        s2.stop('Provider registered in app/bootstrap/providers.ts')
      } catch (e) {
        s2.stop('Could not auto-register provider')
      }

      outro(`Module ${name} created successfully`)
    })
}
