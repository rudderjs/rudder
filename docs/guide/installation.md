# Installation

## Requirements

- **Node.js** `^20.19.0` or `>=22.12.0` (matches Vite 8's required runtime)
- One of: **pnpm**, **npm**, **yarn**, or **bun**

## Scaffold a new project

The fastest way to start is the `create-rudder` scaffolder. It detects your package manager and adapts every generated file accordingly.

```bash
pnpm create rudder my-app
# or: npm create rudder@latest my-app
# or: yarn create rudder my-app
# or: bunx create-rudder my-app
```

> The legacy `create-rudder-app` invocation still works — it now prints a one-line nudge to switch to `create-rudder` and otherwise scaffolds identically.

The scaffolder asks a short recipe-driven sequence, then generates only the code for the choices you made. Selected packages get added to `package.json`, registered via auto-discovery, and have their config files generated. Unselected packages are excluded entirely — no dead code, no orphan config.

| # | Prompt | Notes |
|---|---|---|
| 1 | Project name | — |
| 2 | What are you building? *(recipe)* | Web app · SaaS · API service · Realtime · Minimal · Custom |
| 3 | Database | Native *(default — built-in, no external ORM)* · Prisma · Drizzle *(+ None for Minimal/Custom)* |
| 4 | Database driver | SQLite *(recommended — no setup)* · PostgreSQL · MySQL — asked for every engine, Native included |
| 5 | Frontend framework | React · Vue · Solid · None — skipped for `api-service` / `minimal` |
| 6 | Styling | Tailwind+shadcn · Tailwind · Plain CSS — only when a framework is selected |
| 7 | Is your DB running now? | Only for PostgreSQL/MySQL — if yes, the installer runs your migrations (Native) or pushes the schema (Prisma/Drizzle) |
| 8 | Install and run setup? | `yes` triggers the full auto-cascade described below |

Each recipe is a curated bundle of packages — pick one of the five named recipes for the common shapes, or **Custom** to walk through the full 25-package multiselect.

| Recipe | Adds on top of the framework core | Frontend? |
|---|---|---|
| **Web app** *(default)* | `auth` | yes |
| **SaaS** | `auth` + `queue` + `mail` + `notifications` | yes |
| **API service** | `auth` + `http` | no |
| **Realtime** | `auth` + `broadcast` + `sync` | yes |
| **Minimal** | nothing beyond the framework core | no |
| **Custom** | *(prompts the full multiselect)* | optional |

When **Install and run setup** is `yes` (the default), the scaffolder runs the entire post-scaffold sequence for you — `pnpm install`, `rudder providers:discover`, the database setup (`rudder migrate` on the native engine; `rudder db:generate` + `rudder db:push` for Prisma/Drizzle — on every engine this runs immediately on SQLite, and after your confirmation on Postgres/MySQL), `rudder vendor:publish --tag=auth-views-*` (when needed), `rudder passport:keys` (when Passport is selected), and `git init` + initial commit. On the happy path the final panel says one thing:

```bash
cd my-app && pnpm dev
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

When `create-rudder` runs inside an AI coding agent — Claude Code, Cursor, GitHub Copilot, Codex, Gemini CLI, or Windsurf — it auto-detects via env vars and switches from interactive prompts to a flag-driven flow with structured JSON output to stdout. Agents get a parseable success/failure result instead of garbled TTY redraws.

```bash
CLAUDECODE=1 npx create-rudder my-app \
  --recipe=web-app \
  --framework=react --styling=tailwind+shadcn \
  --install=true
```

```jsonc
// success — single line of JSON to stdout; cascade fields appear only when --install=true
{
  "success": true, "name": "my-app", "directory": "/abs/path/my-app", "files": 36,
  "agent": "claude-code",
  "installed": true, "providersDiscovered": true,
  "dbPushed": true,        // native engine: carries the `rudder migrate` result;
                           // prisma/drizzle additionally report "dbGenerated"
  "gitInitialized": true
}

// missing flags (exit 1)
{ "success": false, "error": "Missing required flags...", "requiredFlags": ["--recipe", "--db"], "agent": "claude-code" }
```

Every prompt has a corresponding flag. Each flag also works in interactive mode — pass `--recipe=web-app` to skip the first question, useful for CI templates.

| Flag | Values |
|---|---|
| `--recipe` | `web-app`, `saas`, `api-service`, `realtime`, `minimal`, `custom` |
| `--orm` | `native` *(default)*, `prisma`, `drizzle`, `none` |
| `--db` | `sqlite` *(default)*, `postgresql`, `mysql` — works with every engine; the native default scaffolds all three. Only required with an explicit `--orm=prisma\|drizzle` |
| `--framework` | `react`, `vue`, `solid`, `none` *(omit for `api-service` / `minimal`)* |
| `--styling` | `tailwind+shadcn`, `tailwind`, `plain` *(optional — recipe picks a sensible default)* |
| `--packages` | comma-separated package names *(only when `--recipe=custom`)* |
| `--db-ready` | `true`, `false` — pre-answers the Postgres/MySQL "is your DB running?" prompt |
| `--git` | `true`, `false` — whether to run `git init` + initial commit *(default `true`)* |
| `--install` | `true`, `false` |
| `--json` | force JSON output regardless of detection |
| `--interactive` | force the prompt UI even inside an agent |

The legacy explicit-flag shape (`--orm` without `--recipe`, plus `--packages`, `--frameworks`, `--primary-framework`, `--tailwind`, `--shadcn`) still parses for backwards-compat with pre-recipe scripts. The `--demos` flag is preserved as a silent no-op — demos were dropped from the default scaffolder.

Set `RUDDER_NONINTERACTIVE=1` in the environment to opt into JSON mode without an agent (e.g. CI scripts).

## Manual installation

For an existing Vite project, install the foundation packages and wire them up by hand.

### 1. Add the core packages

```bash
pnpm add @rudderjs/core @rudderjs/server-hono @rudderjs/router
pnpm add -D vite typescript

# Choose your data layer — native engine (built-in, no external ORM):
pnpm add @rudderjs/orm better-sqlite3
pnpm add -D @types/better-sqlite3

# …or the Prisma adapter:
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

`+server.ts` at the project root connects Vike to the Rudder application:

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

## Keeping up to date

Rudder releases frequently — sometimes daily across the 48 published `@rudderjs/*` packages. To bump every `@rudderjs/*` dependency to the latest version published on npm in one step:

```bash
pnpm rudder upgrade
```

What it does:

1. Finds every `@rudderjs/*` package in your `dependencies`, `devDependencies`, and `peerDependencies`.
2. Queries the npm registry for each one's latest version.
3. Rewrites `package.json` with the new caret ranges.
4. Runs your package manager's install (detected from your lockfile — pnpm / npm / yarn / bun).

### Flags

| Flag | Behavior |
|---|---|
| `--check` | Print the upgrade plan and exit 1 if updates are available. Doesn't modify anything — CI-friendly. |
| `--dry-run` | Show what would change. Doesn't modify `package.json`, doesn't install. |
| `--latest` (default) | Bump to the latest version, including across majors. |
| `--minor` | Cap each bump within the current major (no breaking changes). |
| `--patch` | Cap each bump within the current minor (bug fixes only). |
| `--registry <url>` | Override the npm registry URL (e.g. a private mirror). |

```bash
# Conservative — bug fixes only
pnpm rudder upgrade --patch

# Within-major — pick up new features but no breaking changes
pnpm rudder upgrade --minor

# Preview without applying
pnpm rudder upgrade --dry-run

# CI gate — fail the build when updates are available
pnpm rudder upgrade --check
```

Major bumps are highlighted in red — review the relevant `CHANGELOG.md` before applying. The framework follows semver: a `feat:` release goes minor, a `feat!:` release goes major.

### CHANGELOG snippets

For every package being bumped, `rudder upgrade` fetches its `CHANGELOG.md` from the framework's public GitHub repo, parses out every `## X.Y.Z` section in the window between your current and target versions, and prints a one-line headline per version under the bump row:

```
  @rudderjs/cli  4.6.5 → 4.7.1  (devDependencies)
      4.7.1  rudder upgrade — handle floating dist-tag ranges (latest, *, next)
      4.7.0  rudder upgrade — one-step bump of every @rudderjs/* dep to latest
      4.6.9  stripInternal: true is now set in tsconfig.base.json
      4.6.8  make:controller (and --resource / --api / --singleton) — fix generated stub
      4.6.7  rudder --version and the rudder banner printed a hardcoded 0.0.2
      4.6.6  fix(doctor): load .env before env-var checks
```

Headlines are pulled from the first non-trivial bullet of each version's changeset entry; the cite-prefix (`abc1234:`) is stripped and the noisy `Updated dependencies [...]` lines are skipped.

Flags:

| Flag | Behavior |
|---|---|
| `--no-changelog` | Skip the CHANGELOG fetch entirely. Faster, quieter output — useful for CI gates that only care about `--check`'s exit code. |
| `--changelog-base <url>` | Override the GitHub raw base URL. Useful for fork-based development; default is `https://raw.githubusercontent.com/rudderjs/rudder/main`. |

Fetch failures degrade gracefully — a row whose CHANGELOG can't be fetched simply renders without the indented detail block.

### Peer-dependency mismatches

`rudder upgrade` also fetches each upgraded `@rudderjs/*` package's `peerDependencies` and diffs them against the peers declared in your `package.json`. If a framework package has bumped a peer major past what your app carries, you'll see a warning like:

```
  ⚠ Peer-dependency mismatches:
    vite  — required by @rudderjs/vite@3.0.0
      your package.json: devDependencies.vite = "^7.1.0"
      framework needs:    "^8.0.0"
      reason:             consumer accepts major 7, framework needs major 8

  Update these peer ranges in your package.json (then re-run upgrade).
```

The warning is informational — `rudder upgrade` still completes — but `--check` treats peer mismatches as part of the exit-1 condition, so CI gates catch them.

This closes the gap where `pnpm update --latest "@rudderjs/*"` happily bumps the framework but leaves a stale peer (the `vite 7 → 8` situation behind the scenes on `rudderjs.com`).

## Next steps

- [Configuration](/guide/configuration) — environment variables, runtime config, framework wiring
- [Directory Structure](/guide/directory-structure) — what goes where
- [Service Providers](/guide/service-providers) — register your own services
