# create-rudderjs-app

Interactive CLI scaffolder for [RudderJS](https://github.com/rudderjs/rudderjs) — a Laravel-inspired, framework-agnostic Node.js meta-framework built on Vike + Vite.

## Usage

The installer auto-detects your package manager from the command you use:

```bash
pnpm create rudderjs-app
npm create rudderjs-app@latest
yarn create rudderjs-app
bunx create-rudderjs-app
```

All four package managers are fully supported — generated files, install commands, and next-step instructions adapt automatically.

## Prompts

The installer walks you through up to 12 prompts (several are conditional):

| # | Prompt | Options | Default | Condition |
|---|--------|---------|---------|-----------|
| 1 | Project name | any string | — | always |
| 2 | Database ORM | Prisma · Drizzle · None | Prisma | always |
| 3 | Database driver | SQLite · PostgreSQL · MySQL | SQLite | only if ORM selected |
| 4 | Package checklist | multiselect (see below) | Auth + Cache | always |
| 5 | Add media library plugin? | yes / no | yes | only if panels + storage selected |
| 6 | Add AI workspaces plugin? | yes / no | no | only if panels + ai selected |
| 7 | Include Todo module? | yes / no | yes | only if database selected |
| 8 | Frontend frameworks | React · Vue · Solid (multiselect) | React | always |
| 9 | Primary framework | single select from chosen frameworks | — | only if >1 framework selected |
| 10 | Add Tailwind CSS? | yes / no | yes | always |
| 11 | Add shadcn/ui? | yes / no | yes | only if React + Tailwind |
| 12 | Install dependencies? | yes / no | yes | always |

### Package checklist (prompt 4)

| Choice | Description | Package |
|--------|-------------|---------|
| Authentication | Login, register, sessions | `@rudderjs/auth` |
| Cache | Memory + Redis drivers | `@rudderjs/cache` |
| Queue | Background jobs | `@rudderjs/queue` |
| Storage | File uploads (local + S3) | `@rudderjs/storage` |
| Mail | SMTP + log driver | `@rudderjs/mail` |
| Notifications | Multi-channel notifications | `@rudderjs/notification` |
| Scheduler | Cron-like task scheduling | `@rudderjs/schedule` |
| WebSocket | Real-time channels | `@rudderjs/broadcast` |
| Real-time Collab | Yjs CRDT sync | `@rudderjs/live` |
| AI | LLM providers (Anthropic, OpenAI, Google, Ollama) | `@rudderjs/ai` |
| Admin Panel | Auto-generated CRUD admin | `@rudderjs/panels` |

**Panel plugin sub-prompts** (shown after main checklist when dependencies are met):
- **Media library** — shown when panels + storage selected. Adds `@rudderjs/media` + `@rudderjs/image`, `config/media.ts`, wires `Panel.use(media())`
- **AI workspaces** — shown when panels + ai selected. Adds `@rudderjs/workspaces`, wires `Panel.use(workspaces())`

When **panels** is selected, scaffolds `app/Panels/AdminPanel.ts` with `Panel.make()`, `UserResource` (if auth+orm), `TodoResource` (if todo), and wires `panels()` provider.

When **ai** is selected, generates `config/ai.ts`, `ai()` provider, an AI chat demo page at `/ai-chat`, and `POST /api/ai/chat` route.

Only selected packages get their dependencies, providers, config files, and schema files added to the generated project. Base packages (`core`, `router`, `server-hono`, `middleware`, `vite`, `rudder`, `cli`) are always included.

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
│   ├── console.ts      # Rudder commands
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
cd create-rudderjs-app
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
