# Installation

## Prerequisites

- **Node.js** 18 or later
- **pnpm** 8 or later (recommended; npm and yarn also work)

## Option 1: create-boostkit-app (Recommended)

The fastest way to start a new Forge project is with the official scaffolder:

```bash
pnpm create forge-app my-app
```

Or with npx:

```bash
npx create-boostkit-app my-app
```

The CLI will prompt you for:

1. **Project name** — used as the directory name and `package.json` name
2. **Database driver** — SQLite (default), PostgreSQL, or LibSQL/Turso
3. **Include Todo module?** — scaffolds a full CRUD module as a reference
4. **Run pnpm install?** — install dependencies immediately

After scaffolding:

```bash
cd my-app
pnpm exec prisma db push     # Create the SQLite database
pnpm dev                     # Start the dev server
```

Your app will be running at `http://localhost:3000`.

## Option 2: Manual Installation

If you prefer to set up manually or add Forge to an existing Vite project:

### 1. Install the core packages

```bash
pnpm add @boostkit/core @boostkit/server-hono @boostkit/router
pnpm add -D vite vitepress typescript
```

### 2. Add your chosen ORM

For Prisma (recommended for new projects):

```bash
pnpm add @boostkit/orm @boostkit/orm-prisma @prisma/client
pnpm add -D prisma
```

For Drizzle:

```bash
pnpm add @boostkit/orm @boostkit/orm-drizzle drizzle-orm better-sqlite3
```

### 3. Bootstrap the application

Create `bootstrap/app.ts`. This is both the bootstrap file **and** the application entry point — `import 'reflect-metadata'` goes here:

```ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@boostkit/core'
import { hono } from '@boostkit/server-hono'
import providers from './providers.ts'
import configs from '../config/index.ts'

export default Application.configure({
  server: hono(configs.server),
  config: configs,
  providers,
})
  .withRouting({
    web:      () => import('../routes/web.ts'),
    api:      () => import('../routes/api.ts'),
    commands: () => import('../routes/console.ts'),
  })
  .withMiddleware((_m) => {})
  .withExceptions((_e) => {})
  .create()
```

Create `bootstrap/providers.ts`:

```ts
import type { Application, ServiceProvider } from '@boostkit/core'
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

export default [
  DatabaseServiceProvider,  // must precede AppServiceProvider — sets ModelRegistry
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
```

### 4. Wire Vike to the app

Create `pages/+config.ts` to point Vike's `vike-photon` plugin at `bootstrap/app.ts`:

```ts
import type { Config } from 'vike/types'
import vikePhoton from 'vike-photon/config'

export default {
  extends: [vikePhoton],
  photon: {
    server: 'bootstrap/app.ts',
  },
} as unknown as Config
```

This is the only wiring needed — `vike-photon` consumes the exported `Forge` instance directly as the HTTP server.

### 5. Config files

Create `config/server.ts`:

```ts
import { Env } from '@boostkit/support'

export default {
  port: Env.getNumber('PORT', 3000),
  cors: {
    origin:  Env.get('CORS_ORIGIN', '*'),
    methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    headers: 'Content-Type,Authorization',
  },
}
```

Create `config/index.ts` — collect all config files into a single default export:

```ts
import server from './server.js'
// import database from './database.js'

export default { server }
```

### 6. Vite config

Install `vike-photon`:

```bash
pnpm add vike-photon vike
```



Create `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vike from 'vike/plugin'

export default defineConfig({
  plugins: [vike(), react()],
})
```

## Environment Variables

Create a `.env` file at the project root:

```dotenv
APP_NAME=MyApp
APP_ENV=local
APP_DEBUG=true
PORT=3000
DATABASE_URL="file:./dev.db"
```

## Verifying the Setup

```bash
pnpm build        # Compile TypeScript
pnpm dev          # Start Vite dev server
```

Visit `http://localhost:3000` — you should see the Vike welcome page or your first route response.

## Next Steps

- [Your First App](/guide/your-first-app) — create your first API route and database model
- [Configuration](/guide/configuration) — understand the three config layers
- [Service Providers](/guide/service-providers) — learn the boot lifecycle
