# create-rudder-app

Interactive CLI scaffolder for [RudderJS](https://github.com/rudderjs/rudder) — a Laravel-inspired, framework-agnostic Node.js meta-framework built on Vike + Vite.

## Usage

The installer auto-detects your package manager from the command you use:

```bash
pnpm create rudder-app
npm create rudder-app@latest
yarn create rudder-app
bunx create-rudder-app
```

All four package managers are fully supported — generated files, install commands, and next-step instructions adapt automatically.

## Prompts

The installer walks you through up to 9 prompts (several are conditional):

| # | Prompt | Options | Default | Condition |
|---|--------|---------|---------|-----------|
| 1 | Project name | any string | — | always |
| 2 | Database ORM | Prisma · Drizzle · None | Prisma | always |
| 3 | Database driver | SQLite · PostgreSQL · MySQL | SQLite | only if ORM selected |
| 4 | Package checklist | multiselect (see below) | Auth + Cache | always |
| 5 | Frontend frameworks | React · Vue · Solid (multiselect) | React | always |
| 6 | Primary framework | single select from chosen frameworks | — | only if >1 framework selected |
| 7 | Add Tailwind CSS? | yes / no | yes | always |
| 8 | Add shadcn/ui? | yes / no | yes | only if React + Tailwind |
| 9 | Install dependencies? | yes / no | yes | always |

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
| MCP | Model Context Protocol servers — expose tools/resources to LLMs | `@rudderjs/mcp` |
| Passport (OAuth2) | OAuth 2 server with JWT — **requires Auth + Prisma** | `@rudderjs/passport` |
| Localization | i18n — `trans()`, `setLocale()` | `@rudderjs/localization` |

When **ai** is selected, generates `config/ai.ts`, `ai()` provider, an AI chat demo page at `/ai-chat`, and `POST /api/ai/chat` route.

When **mcp** is selected, generates `app/Mcp/EchoServer.ts` and wires a `POST /mcp/echo` route.

When **passport** is selected, generates `config/passport.ts`, OAuth 2 routes (`/oauth/authorize`, `/oauth/token`, etc.), and the `OAuthClient` + `OAuthAccessToken` Prisma models. Selecting this option fails fast if Auth or Prisma isn't also selected.

Only selected packages get their dependencies, providers, config files, and schema files added to the generated project. Base packages (`core`, `router`, `server-hono`, `middleware`, `vite`, `rudder`, `cli`, `log`) are always included. `session` + `hash` are pulled in automatically when **Authentication** is selected.

## What gets generated

```
my-app/
├── bootstrap/
│   ├── app.ts          # Application.configure()...create()
│   └── providers.ts    # [...(await defaultProviders()), ...app providers]
├── config/             # app, server, log + per-package configs (auth, cache, session, …)
├── app/
│   ├── Models/User.ts              # (if Auth)
│   ├── Views/                      # (if Auth) Welcome + Auth/{Login,Register,...} vendored
│   ├── Mcp/EchoServer.ts           # (if MCP)
│   ├── Providers/AppServiceProvider.ts
│   └── Middleware/RequestIdMiddleware.ts
├── routes/
│   ├── api.ts          # JSON API routes (+ auth endpoints if Auth, + OAuth2 if Passport)
│   ├── web.ts          # Vike page routes + registerAuthRoutes() (if Auth)
│   ├── console.ts      # Rudder commands
│   └── channels.ts     # (if WebSocket) channel auth
├── pages/
│   ├── +config.ts              # Root config — includes renderer when single framework
│   ├── index/+config.ts        # (multi-framework only) per-page renderer config
│   ├── index/+Page.tsx|.vue    # Home page (primary framework)
│   ├── _error/+Page.tsx|.vue   # Error page
│   └── {fw}-demo/+Page.*       # Demo pages for secondary frameworks
├── prisma/schema/              # (if Prisma) multi-file schema directory
│   ├── base.prisma             #   datasource + generator
│   ├── auth.prisma             #   (if Auth) User + PasswordResetToken
│   ├── passport.prisma         #   (if Passport) OAuthClient + OAuthAccessToken
│   ├── notification.prisma     #   (if Notifications)
│   └── modules.prisma          #   placeholder for per-feature modules
├── drizzle/                    # (if Drizzle) schema directory
├── src/index.css               # (if Tailwind)
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
cd create-rudder-app
pnpm build
node dist/index.js          # launches the interactive CLI
```

## After scaffolding

The installer prints the exact commands for your package manager. For reference:

| Step | pnpm | npm | yarn | bun |
|------|------|-----|------|-----|
| Install (if skipped) | `pnpm install` | `npm install` | `yarn install` | `bun install` |
| Discover providers (if install skipped) | `pnpm rudder providers:discover` | `npm run rudder providers:discover` | `yarn rudder providers:discover` | `bun rudder providers:discover` |
| Prisma generate (if Prisma) | `pnpm exec prisma generate` | `npx prisma generate` | `yarn dlx prisma generate` | `bunx prisma generate` |
| Prisma db push (if Prisma) | `pnpm exec prisma db push` | `npx prisma db push` | `yarn dlx prisma db push` | `bunx prisma db push` |
| Drizzle push (if Drizzle) | `pnpm exec drizzle-kit push` | `npx drizzle-kit push` | `yarn dlx drizzle-kit push` | `bunx drizzle-kit push` |
| Passport keys (if Passport) | `pnpm rudder passport:keys` | `npm run rudder passport:keys` | `yarn rudder passport:keys` | `bun rudder passport:keys` |
| Start dev server | `pnpm dev` | `npm run dev` | `yarn dev` | `bun dev` |

When you let the installer run `Install dependencies`, it also runs `rudder providers:discover` automatically so the app boots on first `dev`. If you skipped install, run both manually before `dev`.

## Package manager differences in generated files

| File | pnpm | npm / yarn | bun |
|------|------|-----------|-----|
| `pnpm-workspace.yaml` | generated | not generated | not generated |
| `package.json` native-build field | `pnpm.onlyBuiltDependencies` | *(not needed)* | `trustedDependencies` |
