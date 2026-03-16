# create-boostkit-app

Interactive CLI scaffolder for [BoostKit](https://github.com/boostkitjs/boostkit) — a Laravel-inspired, framework-agnostic Node.js meta-framework built on Vike + Vite.

## Usage

The installer auto-detects your package manager from the command you use:

```bash
pnpm create boostkit-app
npm create boostkit-app@latest
yarn create boostkit-app
bunx create-boostkit-app
```

All four package managers are fully supported — generated files, install commands, and next-step instructions adapt automatically.

## Prompts

The installer walks you through up to 10 prompts (several are conditional):

| # | Prompt | Options | Default | Condition |
|---|--------|---------|---------|-----------|
| 1 | Project name | any string | — | always |
| 2 | Database ORM | Prisma · Drizzle · None | Prisma | always |
| 3 | Database driver | SQLite · PostgreSQL · MySQL | SQLite | only if ORM selected |
| 4 | Package checklist | multiselect (see below) | Auth + Cache | always |
| 5 | Include Todo module? | yes / no | yes | only if database selected |
| 6 | Frontend frameworks | React · Vue · Solid (multiselect) | React | always |
| 7 | Primary framework | single select from chosen frameworks | — | only if >1 framework selected |
| 8 | Add Tailwind CSS? | yes / no | yes | always |
| 9 | Add shadcn/ui? | yes / no | yes | only if React + Tailwind |
| 10 | Install dependencies? | yes / no | yes | always |

### Package checklist (prompt 4)

| Choice | Description | Package |
|--------|-------------|---------|
| Authentication | Login, register, sessions | `@boostkit/auth` |
| Cache | Memory + Redis drivers | `@boostkit/cache` |
| Queue | Background jobs | `@boostkit/queue` |
| Storage | File uploads (local + S3) | `@boostkit/storage` |
| Mail | SMTP + log driver | `@boostkit/mail` |
| Notifications | Multi-channel notifications | `@boostkit/notification` |
| Scheduler | Cron-like task scheduling | `@boostkit/schedule` |
| WebSocket | Real-time channels | `@boostkit/broadcast` |
| Real-time Collab | Yjs CRDT sync | `@boostkit/live` |
| Admin Panel | Auto-generated CRUD admin | `@boostkit/panels` |

Only selected packages get their dependencies, providers, config files, and schema files added to the generated project. Base packages (`core`, `router`, `server-hono`, `middleware`, `vite`, `artisan`, `cli`) are always included.

## What gets generated

```
my-app/
├── bootstrap/
│   ├── app.ts          # Application.configure()...create()
│   └── providers.ts    # Ordered provider array (only selected packages)
├── config/             # app, server + per-package configs (database, auth, cache, etc.)
├── app/
│   ├── Models/User.ts              # (if Auth selected)
│   ├── Providers/AppServiceProvider.ts
│   └── Middleware/RequestIdMiddleware.ts
├── routes/
│   ├── api.ts          # JSON API routes
│   ├── web.ts          # Web/redirect routes
│   ├── console.ts      # Artisan commands
│   └── channels.ts     # (if WebSocket selected) Channel auth
├── pages/
│   ├── +config.ts              # Root config — includes renderer when single framework
│   ├── index/+config.ts        # (multi-framework only) per-page renderer config
│   ├── index/+data.ts          # SSR data loader
│   ├── index/+Page.tsx|.vue    # Home page (primary framework)
│   ├── _error/+Page.tsx|.vue   # Error page (primary framework)
│   └── {fw}-demo/+Page.*       # Demo pages for secondary frameworks (with own +config.ts)
├── app/Modules/Todo/           # (if Todo selected)
├── prisma/schema/              # (if Prisma) multi-file schema directory
│   ├── base.prisma             #   datasource + generator
│   └── user.prisma             #   (if Auth) User model
├── drizzle/                    # (if Drizzle) schema directory
├── src/index.css               # (if Tailwind selected)
├── vite.config.ts
├── tsconfig.json
├── .env + .env.example
└── package.json
```

### Framework combinations

| Selection | Page extension | tsconfig jsx |
|-----------|---------------|--------------|
| React only | `.tsx` | `react-jsx` |
| Vue only | `.vue` | *(omitted)* |
| Solid only | `.tsx` | `preserve` + `jsxImportSource: solid-js` |
| React + Vue | `.tsx` (React primary) | `react-jsx` |
| React + Solid | `.tsx` — Vite plugins use include/exclude to disambiguate | `react-jsx` |
| All three | `.tsx` or `.vue` depending on primary | `react-jsx` |

**Single framework:** the renderer (`vike-react`, `vike-vue`, or `vike-solid`) is included directly in the root `+config.ts` — no per-page `+config.ts` needed.

**Multiple frameworks:** the root `+config.ts` has no renderer. Each page/folder declares its own `+config.ts` extending the appropriate renderer. Secondary frameworks get a minimal demo page at `pages/{fw}-demo/`.

### CSS variants

| Selection | `src/index.css` content |
|-----------|------------------------|
| Tailwind + shadcn | Full shadcn CSS variables + `@import "shadcn/tailwind.css"` |
| Tailwind only | `@import "tailwindcss"; @import "tw-animate-css";` |
| No Tailwind | File not generated |

## Local development / testing

```bash
cd create-boostkit-app
pnpm build
node dist/index.js          # launches the interactive CLI
```

## After scaffolding

The installer prints the exact commands for your package manager. For reference:

| Step | pnpm | npm | yarn | bun |
|------|------|-----|------|-----|
| Install (if skipped) | `pnpm install` | `npm install` | `yarn install` | `bun install` |
| Prisma generate (if Prisma) | `pnpm exec prisma generate` | `npx prisma generate` | `yarn dlx prisma generate` | `bunx prisma generate` |
| Prisma db push (if Prisma) | `pnpm exec prisma db push` | `npx prisma db push` | `yarn dlx prisma db push` | `bunx prisma db push` |
| Drizzle push (if Drizzle) | `pnpm exec drizzle-kit push` | `npx drizzle-kit push` | `yarn dlx drizzle-kit push` | `bunx drizzle-kit push` |
| Start dev server | `pnpm dev` | `npm run dev` | `yarn dev` | `bun dev` |

## Package manager differences in generated files

| File | pnpm | npm / yarn | bun |
|------|------|-----------|-----|
| `pnpm-workspace.yaml` | generated | not generated | not generated |
| `package.json` native-build field | `pnpm.onlyBuiltDependencies` | *(not needed)* | `trustedDependencies` |
