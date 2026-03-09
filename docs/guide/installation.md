# Installation

## Prerequisites

- **Node.js** 18 or later
- Any of: **pnpm**, **npm**, **yarn**, or **bun**

## Option 1: create-boostkit-app (Recommended)

The fastest way to start a new BoostKit project is with the official scaffolder. Use whichever package manager you prefer — the installer auto-detects it and adapts all generated files and next-step instructions accordingly:

```bash
pnpm create boostkit-app my-app
# or
npm create boostkit-app@latest my-app
# or
yarn create boostkit-app my-app
# or
bunx create-boostkit-app my-app
```

The CLI walks you through 8 prompts:

| # | Prompt | Options | Default |
|---|--------|---------|---------|
| 1 | **Project name** | any string | — |
| 2 | **Database driver** | SQLite · PostgreSQL · MySQL | SQLite |
| 3 | **Include Todo module?** | yes / no | yes |
| 4 | **Frontend frameworks** | React · Vue · Solid *(multiselect)* | React |
| 5 | **Primary framework** | one of the selected | *(only shown when >1 selected)* |
| 6 | **Add Tailwind CSS?** | yes / no | yes |
| 7 | **Add shadcn/ui?** | yes / no | yes *(only shown when React + Tailwind)* |
| 8 | **Install dependencies?** | yes / no | yes |

After scaffolding, the CLI prints the exact commands for your package manager. For reference:

| Step | pnpm | npm | yarn | bun |
|------|------|-----|------|-----|
| Prisma generate | `pnpm exec prisma generate` | `npx prisma generate` | `yarn dlx prisma generate` | `bunx prisma generate` |
| Prisma db push | `pnpm exec prisma db push` | `npx prisma db push` | `yarn dlx prisma db push` | `bunx prisma db push` |
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

If you prefer to set up manually or add BoostKit to an existing Vite project:

### 1. Install the core packages

```bash
pnpm add @boostkit/core @boostkit/server-hono @boostkit/router
pnpm add -D vite typescript
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
  .create()
```

Create `bootstrap/providers.ts`:

```ts
import type { Application, ServiceProvider } from '@boostkit/core'
import { database } from '@boostkit/orm-prisma'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import configs from '../config/index.js'

export default [
  database(configs.database),  // binds PrismaClient to DI as 'prisma'
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
```

### 4. Wire Vike to the app

Create `pages/+config.ts`. Include both `vike-photon` and your UI framework renderer here — this single file is all you need for a single-framework app:

```ts
// pages/+config.ts (React)
import type { Config } from 'vike/types'
import vikePhoton from 'vike-photon/config'
import vikeReact from 'vike-react/config'

export default {
  extends: [vikePhoton, vikeReact],
  photon: {
    server: 'bootstrap/app.ts',
  },
} as unknown as Config
```

For **Vue** replace `vike-react/config` with `vike-vue/config`, for **Solid** use `vike-solid/config`.

> **Multiple frameworks?** Keep the renderer out of the root `pages/+config.ts` and instead add a `+config.ts` inside each page folder extending its own renderer. See [Frontend Pages](/guide/frontend-pages) for details.

### 5. Vite config

```bash
pnpm add vike vike-photon
# plus your framework plugin:
pnpm add -D @vitejs/plugin-react    # React
pnpm add    vike-vue                # Vue
pnpm add    vike-solid              # Solid
```

`vite.config.ts` — include only the plugins for your chosen frameworks:

```ts
import { defineConfig } from 'vite'
import boostkit from '@boostkit/vite'
import react from '@vitejs/plugin-react'   // React only

export default defineConfig({
  plugins: [boostkit(), react()],
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
