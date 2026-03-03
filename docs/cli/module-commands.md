# module: Commands

The `module:*` commands help you create and manage self-contained feature modules, including Prisma schema shards.

## `make:module`

Scaffolds a complete feature module — models, services, providers, routes, and a Prisma schema shard.

```bash
pnpm artisan make:module Blog
```

This creates the following structure:

```
app/
└── Blog/
    ├── Models/
    │   └── BlogPost.ts
    ├── Services/
    │   └── BlogService.ts
    ├── Providers/
    │   └── BlogServiceProvider.ts
    ├── Http/
    │   └── Controllers/
    │       └── BlogController.ts
    └── schema.prisma           # Prisma schema shard for this module
```

Additionally creates:
- `routes/blog.ts` — route definitions for the module
- `tests/blog.test.ts` — test stub

### What gets generated

**`BlogServiceProvider.ts`** — a service provider that registers the module's services:

```ts
import { ServiceProvider } from '@boostkit/core'
import { BlogService } from '../Services/BlogService.js'

export class BlogServiceProvider extends ServiceProvider {
  register() {
    this.app.singleton(BlogService, () => new BlogService())
  }
}
```

**`schema.prisma` shard** — a partial Prisma schema for the module's models:

```prisma
// This file is a Prisma schema shard.
// Run `pnpm artisan module:publish` to merge into prisma/schema.prisma

model BlogPost {
  id        String   @id @default(cuid())
  title     String
  content   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Registering the module

After generating, add the provider to `bootstrap/providers.ts`:

```ts
import { BlogServiceProvider } from '../app/Blog/Providers/BlogServiceProvider.js'

export default [
  DatabaseServiceProvider,
  BlogServiceProvider,  // ← add here
  AppServiceProvider,
]
```

And add the routes to `bootstrap/app.ts`:

```ts
.withRouting({
  api:      () => import('../routes/api.ts'),
  blog:     () => import('../routes/blog.ts'),    // ← add here
  commands: () => import('../routes/console.ts'),
})
```

## `module:publish`

Merges all `*.prisma` schema shards from across the `app/` directory into the main `prisma/schema.prisma` file.

```bash
pnpm artisan module:publish
```

This command:

1. Scans `app/**/schema.prisma` for module schema shards
2. Extracts model definitions from each shard
3. Appends them to `prisma/schema.prisma`
4. Reports which models were added

After publishing, run Prisma to apply the schema:

```bash
pnpm exec prisma generate
pnpm exec prisma db push     # dev
# or
pnpm exec prisma migrate dev # production migrations
```

### Schema shard format

Each shard is a valid Prisma schema fragment containing only `model` blocks (no `datasource` or `generator`):

```prisma
// app/Blog/schema.prisma

model BlogPost {
  id        String   @id @default(cuid())
  title     String
  content   String
  authorId  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

The `module:publish` command handles deduplication — running it multiple times on the same shard is safe.

## Module Workflow

The typical module development workflow:

```bash
# 1. Scaffold the module
pnpm artisan make:module Blog

# 2. Edit the schema shard
vi app/Blog/schema.prisma

# 3. Publish shards to main schema
pnpm artisan module:publish

# 4. Sync schema to database
pnpm exec prisma generate
pnpm exec prisma db push

# 5. Register the module's provider and routes
vi bootstrap/providers.ts
vi bootstrap/app.ts
```

## Summary

| Command | Description |
|---------|-------------|
| `make:module <Name>` | Scaffold a complete feature module with models, services, providers, controller, and Prisma shard |
| `module:publish` | Merge all `app/**/schema.prisma` shards into `prisma/schema.prisma` |
