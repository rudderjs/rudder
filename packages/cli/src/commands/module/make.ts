import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import type { Command } from 'commander'
import { intro, outro, spinner, log } from '@clack/prompts'

// ─── File stubs ────────────────────────────────────────────

export function schemaStub(name: string): string {
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

export function serviceStub(name: string): string {
  return `import { Injectable } from '@boostkit/core'
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

export function providerStub(name: string): string {
  const prefix = `/api/${name.replace(/([A-Z])/g, (m, l, i) => (i === 0 ? l : `-${l}`)).toLowerCase()}s`
  return `import { ServiceProvider } from '@boostkit/core'
import { router } from '@boostkit/router'
import { ${name}Service } from './${name}Service.js'
import { ${name}InputSchema } from './${name}Schema.js'

export class ${name}ServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(${name}Service, () => new ${name}Service())
  }

  override async boot(): Promise<void> {
    const service = this.app.make<${name}Service>(${name}Service)

    router.get('${prefix}', async (_req, res) => {
      res.json({ data: await service.findAll() })
    })

    router.get('${prefix}/:id', async (req, res) => {
      const item = await service.findById(req.params['id']!)
      if (!item) { res.status(404).json({ message: 'Not found.' }); return }
      res.json({ data: item })
    })

    router.post('${prefix}', async (req, res) => {
      const parsed = ${name}InputSchema.safeParse(req.body)
      if (!parsed.success) { res.status(422).json({ errors: parsed.error.flatten().fieldErrors }); return }
      res.status(201).json({ data: await service.create(parsed.data) })
    })
  }
}
`
}

export function testStub(name: string): string {
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

export function prismaStub(name: string): string {
  return `model ${name} {
  id        String   @id @default(cuid())
  // TODO: add fields
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`
}

// ─── Auto-registration ─────────────────────────────────────

export async function autoRegisterProvider(name: string, cwd: string): Promise<void> {
  const bootstrapPath = resolve(cwd, 'bootstrap/providers.ts')
  const importLine    = `import { ${name}ServiceProvider } from '../app/Modules/${name}/${name}ServiceProvider.js'`
  const pushLine      = `  ${name}ServiceProvider,`

  const template = `import type { ServiceProvider } from '@boostkit/core'
import type { Application } from '@boostkit/core'

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
    .description('Scaffold a new module with schema, service, provider, test, and Prisma model')
    .option('-f, --force', 'Overwrite existing files')
    .action(async (name: string, opts: { force?: boolean }) => {
      intro(`Creating module: ${name}`)

      const moduleDir = resolve(process.cwd(), `app/Modules/${name}`)
      const files: Array<{ path: string; content: string }> = [
        { path: `${moduleDir}/${name}Schema.ts`,          content: schemaStub(name) },
        { path: `${moduleDir}/${name}Service.ts`,         content: serviceStub(name) },
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
          return
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
      } catch (_e) {
        s2.stop('Could not auto-register provider')
      }

      outro(`Module ${name} created successfully`)
    })
}
