# Installation

## Requirements

- **Node.js** `^20.19.0` or `>=22.12.0` (matches Vite 7's required runtime)
- One of: **pnpm**, **npm**, **yarn**, or **bun**

## Scaffold a new project

The fastest way to start is the `create-rudder-app` scaffolder. It detects your package manager and adapts every generated file accordingly.

```bash
pnpm create rudder-app my-app
# or: npm create rudder-app@latest my-app
# or: yarn create rudder-app my-app
# or: bunx create-rudder-app my-app
```

The scaffolder asks a series of questions, then generates only the code for the choices you made. Selected packages get added to `package.json`, registered in `bootstrap/providers.ts`, and have their config files generated. Unselected packages are excluded entirely — no dead code, no orphan config.

| # | Prompt | Notes |
|---|---|---|
| 1 | Project name | — |
| 2 | Database ORM | Prisma · Drizzle · None |
| 3 | Database driver | SQLite · PostgreSQL · MySQL — only when an ORM is selected |
| 4 | Packages *(multiselect)* | Auth · Cache · Queue · Storage · Mail · Notifications · Scheduler · WebSocket · Sync · AI · MCP · Passport · Localization · Telescope · Boost · Demos |
| 5 | Frontend frameworks | React · Vue · Solid (multiselect) |
| 6 | Primary framework | only when more than one is selected |
| 7 | Add Tailwind CSS? | — |
| 8 | Add shadcn/ui? | only when React + Tailwind |
| 9 | Install dependencies? | — |

When the scaffolder finishes it prints the exact next-step commands for your package manager. The shape is always:

```bash
pnpm rudder migrate    # apply database schema
pnpm dev               # start the dev server
```

Your app runs at `http://localhost:3000`.

### Frontend combinations

The scaffolder supports any combination of React, Vue, and Solid. The **primary framework** drives the main pages (`pages/index/`, `pages/_error/`); each secondary framework gets a minimal demo at `pages/{fw}-demo/`. When React and Solid coexist, the Vite config automatically routes `.tsx` files to the correct plugin.

| Primary | Page extension | tsconfig |
|---|---|---|
| React | `.tsx` | `jsx: react-jsx` |
| Vue | `.vue` | — |
| Solid | `.tsx` | `jsx: preserve` + `jsxImportSource: solid-js` |

### Tailwind & shadcn

shadcn/ui is offered only when React and Tailwind are both selected.

| Selection | What's generated |
|---|---|
| Tailwind + shadcn | `src/index.css` with full shadcn CSS variables |
| Tailwind only | `src/index.css` with `@import "tailwindcss"` |
| Neither | No `src/index.css`; pages use semantic CSS classes |

### Non-interactive (CI / AI agents)

When `create-rudder-app` runs inside an AI coding agent — Claude Code, Cursor, GitHub Copilot, Codex, Gemini CLI, or Windsurf — it auto-detects via env vars and switches from interactive prompts to a flag-driven flow with structured JSON output to stdout. Agents get a parseable success/failure result instead of garbled TTY redraws.

```bash
CLAUDECODE=1 npx create-rudder-app my-app \
  --orm=prisma --db=sqlite \
  --packages=auth,queue,mail \
  --frameworks=react --tailwind=true --shadcn=true \
  --demos=contact --install=true
```

```jsonc
// success — single line of JSON to stdout
{ "success": true, "name": "my-app", "directory": "/abs/path/my-app", "files": 42, "agent": "claude-code", "installed": true, "providersDiscovered": true }

// missing flags (exit 1)
{ "success": false, "error": "Missing required flags...", "requiredFlags": ["--orm", "--db"], "agent": "claude-code" }
```

Every prompt has a corresponding flag. Each flag also works in interactive mode — pass `--orm=prisma` to skip just that question, useful for CI templates.

| Flag | Values |
|---|---|
| `--orm` | `prisma`, `drizzle`, `none` |
| `--db` | `sqlite`, `postgresql`, `mysql` *(omit when `--orm=none`)* |
| `--packages` | comma-separated package names; `*` = all defaults; empty string = none |
| `--frameworks` | comma-separated: `react`, `vue`, `solid` |
| `--primary-framework` | `react`, `vue`, `solid` *(only when >1 framework)* |
| `--tailwind` | `true`, `false` |
| `--shadcn` | `true`, `false` *(only when react + tailwind=true)* |
| `--demos` | comma-separated demo ids; `*` = all gated-available; empty = none |
| `--install` | `true`, `false` |
| `--json` | force JSON output regardless of detection |
| `--interactive` | force the prompt UI even inside an agent |

Set `RUDDER_NONINTERACTIVE=1` in the environment to opt into JSON mode without an agent (e.g. CI scripts).

## Manual installation

For an existing Vite project, install the foundation packages and wire them up by hand.

### 1. Add the core packages

```bash
pnpm add @rudderjs/core @rudderjs/server-hono @rudderjs/router
pnpm add -D vite typescript

# Choose your ORM:
pnpm add @rudderjs/orm @rudderjs/orm-prisma @prisma/client
pnpm add -D prisma
```

### 2. Bootstrap the application

`bootstrap/app.ts` is both the bootstrap file and the application entry point. It must `import 'reflect-metadata'` — that one import enables the entire DI container.

```ts
// bootstrap/app.ts
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
  .create()
```

```ts
// bootstrap/providers.ts
import { defaultProviders } from '@rudderjs/core'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

export default [
  ...(await defaultProviders()),
  AppServiceProvider,
]
```

### 3. Wire Vike

`+server.ts` at the project root connects Vike to the RudderJS application:

```ts
// +server.ts
import type { Server } from 'vike/types'
import app from './bootstrap/app.js'

export default { fetch: app.fetch } satisfies Server
```

For single-framework apps, declare the renderer in `pages/+config.ts`:

```ts
// pages/+config.ts
import type { Config } from 'vike/types'
import vikeReact from 'vike-react/config'

export default { extends: [vikeReact] } satisfies Config
```

For Vue or Solid replace `vike-react/config` with `vike-vue/config` or `vike-solid/config`. For multiple frameworks, see [Frontend](/guide/frontend).

### 4. Vite config

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vike from 'vike/plugin'
import rudderjs from '@rudderjs/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [rudderjs(), vike(), react()],
})
```

> **Plugin order matters.** Put `rudderjs()` **before** `vike()` — the views-scanner writes auto-generated stubs to `pages/__view/` during plugin construction, and Vike scans `pages/` during its own construction, so the stubs must exist before `vike()` is called.

### 5. Environment variables

```dotenv
APP_NAME=MyApp
APP_ENV=local
APP_DEBUG=true
PORT=3000
DATABASE_URL="file:./dev.db"
AUTH_SECRET=your-32-char-secret-here
```

Never commit `.env`. Provide `.env.example` as a template.

## Next steps

- [Configuration](/guide/configuration) — environment variables, runtime config, framework wiring
- [Directory Structure](/guide/directory-structure) — what goes where
- [Service Providers](/guide/service-providers) — register your own services
