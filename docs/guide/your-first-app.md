# Your First App

This guide walks through building a simple REST API with RudderJS — a `/api/users` endpoint backed by a database model. By the end you'll have a working RudderJS application with routing, a service provider, and ORM integration.

## Prerequisites

You should have a RudderJS project scaffolded already. If not, see [Installation](/guide/installation).

## 1. Define a Model

Create `app/Models/User.ts`:

```ts
import { Model } from '@rudderjs/orm'

export class User extends Model {
  static table = 'user'   // Prisma accessor name (lowercase model name)

  id!: string
  name!: string
  email!: string
  role!: string
  createdAt!: Date
}
```

The `static table` property maps to the Prisma model name in lowercase (or the Drizzle table key if using Drizzle).

## 2. Define the Prisma Schema

Add to `prisma/schema.prisma`:

```prisma
model User {
  id        String   @id @default(cuid())
  name      String
  email     String   @unique
  role      String   @default("user")
  createdAt DateTime @default(now())
}
```

Then push it to the database:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
```

## 3. Register the database provider

Wire the database in `bootstrap/providers.ts`. The `database()` factory handles connection, `ModelRegistry.set()`, and DI binding automatically:

```ts
import { database } from '@rudderjs/orm-prisma'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import configs from '../config/index.js'

export default [
  database(configs.database),   // first — connects DB and sets up ModelRegistry
  AppServiceProvider,
]
```

A minimal `config/database.ts`:

```ts
import { Env } from '@rudderjs/support'

export default {
  default: 'sqlite' as const,
  connections: {
    sqlite: { driver: 'sqlite' as const, url: Env.get('DATABASE_URL', 'file:./dev.db') },
  },
}
```

## 4. Create a Service

Services contain your business logic. Create `app/Services/UserService.ts`:

```ts
import { User } from '../Models/User.js'

export class UserService {
  async all() {
    return User.all()
  }

  async find(id: string) {
    return User.find(id)
  }

  async create(data: { name: string; email: string }) {
    return User.create({ ...data, role: 'user' })
  }
}
```

Bind it in `app/Providers/AppServiceProvider.ts`:

```ts
import { ServiceProvider } from '@rudderjs/core'
import { UserService } from '../Services/UserService.js'

export class AppServiceProvider extends ServiceProvider {
  register() {
    this.app.singleton(UserService, () => new UserService())
  }
}
```

## 5. Add Routes

Edit `routes/api.ts`:

```ts
import { router } from '@rudderjs/router'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import { app } from '@rudderjs/core'
import { UserService } from '../app/Services/UserService.js'

router.get('/api/users', async (_req: AppRequest, res: AppResponse) => {
  const service = app().make(UserService)
  const users = await service.all()
  return res.json({ data: users })
})

router.post('/api/users', async (req: AppRequest, res: AppResponse) => {
  const { name, email } = req.body as { name: string; email: string }
  const service = app().make(UserService)
  const user = await service.create({ name, email })
  return res.status(201).json({ data: user })
})

router.get('/api/users/:id', async (req: AppRequest, res: AppResponse) => {
  const service = app().make(UserService)
  const user = await service.find(req.params.id as string)
  if (!user) return res.status(404).json({ message: 'Not found' })
  return res.json({ data: user })
})

router.all('/api/*', (_req: AppRequest, res: AppResponse) => {
  return res.status(404).json({ message: 'Route not found.' })
})
```

## 6. Run the App

```bash
pnpm dev
```

Test your endpoints:

```bash
# List users
curl http://localhost:3000/api/users

# Create a user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com"}'

# Get a user
curl http://localhost:3000/api/users/<id>
```

## 7. Add an Rudder Seed Command

Create a seed command in `routes/console.ts`:

```ts
import { rudder } from '@rudderjs/rudder'
import { User } from '../app/Models/User.js'

rudder.command('db:seed', async () => {
  await User.create({ name: 'Alice', email: 'alice@example.com', role: 'admin' })
  await User.create({ name: 'Bob',   email: 'bob@example.com',   role: 'user' })
  console.log('Seeded 2 users.')
}).description('Seed the database with sample users')
```

Run it:

```bash
pnpm rudder db:seed
```

## Summary

In a few steps you have:

1. **Model** — `User` extends `Model`, maps to a Prisma/Drizzle table
2. **Service Provider** — connects the database, registers singleton services
3. **Service** — business logic isolated in `UserService`
4. **Routes** — `router.get/post` on `/api/users`
5. **Rudder command** — seed script accessible via CLI

## Next Steps

- [Configuration](/guide/configuration) — manage environment variables and config files
- [Dependency Injection](/guide/dependency-injection) — constructor injection with `@Injectable`
- [Routing](/guide/routing) — decorator-based controllers
- [Validation](/guide/validation) — validate request input with `FormRequest`
