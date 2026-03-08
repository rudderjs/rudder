# module: Commands

The `module:*` commands help you create and manage self-contained feature modules, including Prisma schema shards.

## `make:module`

Scaffolds a complete feature module — schema, service, provider, test, and a Prisma shard — all inside `app/Modules/<Name>/`.

```bash
pnpm artisan make:module Blog
```

This creates the following structure:

```
app/Modules/Blog/
├── BlogSchema.ts            # Zod input/output schemas and types
├── BlogService.ts           # @Injectable() service with CRUD stubs
├── BlogServiceProvider.ts   # ServiceProvider — registers DI + REST routes
├── Blog.test.ts             # Basic schema validation tests (node:test)
└── Blog.prisma              # Prisma model shard
```

It also auto-registers `BlogServiceProvider` in `bootstrap/providers.ts` (inserting the import and adding it to the providers array).

### What gets generated

**`BlogSchema.ts`** — Zod schemas and TypeScript types:

```ts
import { z } from 'zod'

export const BlogInputSchema = z.object({
  name: z.string().min(1),
})

export const BlogOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

export type BlogInput = z.infer<typeof BlogInputSchema>
export type Blog = z.infer<typeof BlogOutputSchema>
```

**`BlogService.ts`** — Injectable service with CRUD stubs:

```ts
import { Injectable } from '@boostkit/core'
import type { BlogInput, Blog } from './BlogSchema.js'

@Injectable()
export class BlogService {
  async findAll(): Promise<Blog[]> { return [] }
  async findById(id: string): Promise<Blog | null> { return null }
  async create(input: BlogInput): Promise<Blog> { throw new Error('Not implemented') }
}
```

**`BlogServiceProvider.ts`** — Registers DI bindings and REST routes:

```ts
import { ServiceProvider } from '@boostkit/core'
import { router } from '@boostkit/router'
import { BlogService } from './BlogService.js'
import { BlogInputSchema } from './BlogSchema.js'

export class BlogServiceProvider extends ServiceProvider {
  register(): void {
    this.app.singleton(BlogService, () => new BlogService())
  }

  override async boot(): Promise<void> {
    const service = this.app.make<BlogService>(BlogService)

    router.get('/api/blogs', async (_req, res) => {
      res.json({ data: await service.findAll() })
    })

    router.get('/api/blogs/:id', async (req, res) => {
      const item = await service.findById(req.params['id']!)
      if (!item) { res.status(404).json({ message: 'Not found.' }); return }
      res.json({ data: item })
    })

    router.post('/api/blogs', async (req, res) => {
      const parsed = BlogInputSchema.safeParse(req.body)
      if (!parsed.success) { res.status(422).json({ errors: parsed.error.flatten().fieldErrors }); return }
      res.status(201).json({ data: await service.create(parsed.data) })
    })
  }
}
```

**`Blog.prisma`** — Prisma model shard:

```prisma
model Blog {
  id        String   @id @default(cuid())
  // TODO: add fields
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### After scaffolding

1. Edit the files to add your domain fields
2. Run `pnpm artisan module:publish --generate` to merge the shard and regenerate the Prisma client

## `module:publish`

Merges all `*.prisma` shards from `app/Modules/` into the main `prisma/schema.prisma` file.

```bash
pnpm artisan module:publish
pnpm artisan module:publish Blog          # only merge Blog's shard
pnpm artisan module:publish --generate   # merge + run prisma generate
pnpm artisan module:publish --migrate    # merge + run prisma migrate dev
pnpm artisan module:publish --migrate --name add-blog-table
```

### Options

| Option | Description |
|--------|-------------|
| `[module]` | Optional module name filter — only process that module's shard |
| `--generate` | Run `prisma generate` after merging |
| `--migrate` | Run `prisma migrate dev` after merging |
| `--name <name>` | Migration name when using `--migrate` (default: `auto`) |

### How it works

The command uses marker comments in `prisma/schema.prisma` to manage the merged block:

```prisma
// prisma/schema.prisma

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// <boostkit:modules:start>
// module: Blog (Blog.prisma)
model Blog {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
// <boostkit:modules:end>
```

On subsequent runs, the content between the markers is replaced — running `module:publish` multiple times is safe.

## Module Workflow

The typical module development workflow:

```bash
# 1. Scaffold the module
pnpm artisan make:module Blog

# 2. Edit the schema shard
vi app/Modules/Blog/Blog.prisma

# 3. Publish shards to main schema and regenerate client
pnpm artisan module:publish --generate

# 4. Sync schema to database (dev)
pnpm exec prisma db push

# 5. Edit BlogSchema.ts, BlogService.ts to add real logic
```

## Summary

| Command | Description |
|---------|-------------|
| `make:module <Name>` | Scaffold a complete feature module (schema, service, provider, test, Prisma shard) |
| `module:publish [module]` | Merge `*.prisma` shards from `app/Modules/` into `prisma/schema.prisma` |
