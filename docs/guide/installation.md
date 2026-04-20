# Installation

## Prerequisites

- **Node.js** 18 or later
- Any of: **pnpm**, **npm**, **yarn**, or **bun**

## Option 1: create-rudder-app (Recommended)

The fastest way to start a new RudderJS project is with the official scaffolder. Use whichever package manager you prefer — the installer auto-detects it and adapts all generated files and next-step instructions accordingly:

```bash
pnpm create rudder-app my-app
# or
npm create rudder-app@latest my-app
# or
yarn create rudder-app my-app
# or
bunx create-rudder-app my-app
```

The CLI walks you through a series of prompts, adapting follow-up questions based on your choices:

| # | Prompt | Options | Default | Condition |
|---|--------|---------|---------|-----------|
| 1 | **Project name** | any string | — | always |
| 2 | **Database ORM** | Prisma · Drizzle · None | Prisma | always |
| 3 | **Database driver** | SQLite · PostgreSQL · MySQL | SQLite | only when ORM selected |
| 4 | **Packages** | Auth · Cache · Queue · Storage · Mail · Notifications · Scheduler · WebSocket · Real-time Collab · AI · MCP · Passport · Localization · Telescope · Boost *(multiselect)* | — | always |
| 5 | **Include Todo module?** | yes / no | yes | only when a database ORM is selected |
| 6 | **Frontend frameworks** | React · Vue · Solid *(multiselect)* | React | always |
| 7 | **Primary framework** | one of the selected | — | only when >1 framework selected |
| 8 | **Add Tailwind CSS?** | yes / no | yes | always |
| 9 | **Add shadcn/ui?** | yes / no | yes | only when React + Tailwind |
| 10 | **Install dependencies?** | yes / no | yes | always |

Only the packages you select in step 4 get their dependencies added to `package.json`, their service providers registered in `bootstrap/providers.ts`, their config files generated in `config/`, and their schema files published (e.g. `prisma/schema/auth.prisma`). Unselected packages are excluded entirely — no dead code or unused config.

After scaffolding, the CLI prints the exact commands for your package manager. For reference:

| Step | pnpm | npm | yarn | bun |
|------|------|-----|------|-----|
| Migrate | `pnpm rudder migrate` | `npm run rudder migrate` | `yarn rudder migrate` | `bun rudder migrate` |
| Dev server | `pnpm dev` | `npm run dev` | `yarn dev` | `bun dev` |

Your app will be running at `http://localhost:3000`.

### Framework combinations

The scaffolder supports all combinations of React, Vue, and Solid. The **primary framework** drives all main pages (`pages/index/`, `pages/_error/`, `pages/todos/`). Each **secondary framework** gets a minimal demo page at `pages/{fw}-demo/`.

| Primary | Page extension | Notes |
|---------|---------------|-------|
| React | `.tsx` | `jsx: react-jsx` in tsconfig |
| Vue | `.vue` | No jsx config needed |
| Solid | `.tsx` | `jsx: preserve` + `jsxImportSource: solid-js` |

When React and Solid are both selected, the Vite config automatically applies `include`/`exclude` rules to each plugin so `.tsx` files are processed by the correct framework.

### CSS / UI options

| Selection | What's generated |
|-----------|-----------------|
| Tailwind + shadcn | `src/index.css` with full shadcn CSS variables |
| Tailwind only | `src/index.css` with `@import "tailwindcss"` |
| Neither | No `src/index.css` |

shadcn/ui is only offered when React and Tailwind are both selected.

## Option 2: Manual Installation

If you prefer to set up manually or add RudderJS to an existing Vite project:

### 1. Install the core packages

```bash
pnpm add @rudderjs/core @rudderjs/server-hono @rudderjs/router
pnpm add -D vite typescript
```

### 2. Add your chosen ORM

For Prisma (recommended for new projects):

```bash
pnpm add @rudderjs/orm @rudderjs/orm-prisma @prisma/client
pnpm add -D prisma
```

For Drizzle:

```bash
pnpm add @rudderjs/orm @rudderjs/orm-drizzle drizzle-orm better-sqlite3
```

### 3. Bootstrap the application

Create `bootstrap/app.ts`. This is both the bootstrap file **and** the application entry point — `import 'reflect-metadata'` goes here:

```ts
import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
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
  .create()
```

Create `bootstrap/providers.ts`:

```ts
import type { Application, ServiceProvider } from '@rudderjs/core'
import { database } from '@rudderjs/orm-prisma'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import configs from '../config/index.js'

export default [
  database(configs.database),  // binds PrismaClient to DI as 'prisma'
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
```

### 4. Wire Vike to the app

Create `+server.ts` at the project root. This connects Vike to your RudderJS application:

```ts
// +server.ts (project root)
import type { Server } from 'vike/types'
import app from './bootstrap/app.js'

export default {
  fetch: app.fetch,
} satisfies Server
```

Create `pages/+config.ts`. For a single-framework app, declare the UI renderer here:

```ts
// pages/+config.ts (React)
import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default {
  extends: [vikeReact],
} satisfies Config
```

For **Vue** replace `vike-react/config` with `vike-vue/config`, for **Solid** use `vike-solid/config`.

> **Multiple frameworks?** Keep the renderer out of `pages/+config.ts` and instead add a `+config.ts` inside each page folder extending its own renderer. See [Frontend Pages](/guide/frontend-pages) for details.

### 5. Vite config

```bash
pnpm add vike @vikejs/hono
# plus your framework plugin:
pnpm add -D @vitejs/plugin-react    # React
pnpm add    vike-vue                # Vue
pnpm add    vike-solid              # Solid
```

`vite.config.ts` — include only the plugins for your chosen frameworks:

```ts
import { defineConfig } from 'vite'
import rudderjs from '@rudderjs/vite'
import react from '@vitejs/plugin-react'   // React only

export default defineConfig({
  plugins: [rudderjs(), react()],
})
```

### 6. Environment variables

Create a `.env` file at the project root:

```dotenv
APP_NAME=MyApp
APP_ENV=local
APP_DEBUG=true
PORT=3000
DATABASE_URL="file:./dev.db"
AUTH_SECRET=your-32-char-secret-here
```

## Next Steps

- [Your First App](/guide/your-first-app) — create your first API route and database model
- [Configuration](/guide/configuration) — understand the three config layers
- [Service Providers](/guide/service-providers) — learn the boot lifecycle
