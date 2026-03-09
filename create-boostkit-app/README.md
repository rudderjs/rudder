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

The installer walks you through up to 8 prompts (2 are conditional):

| Prompt | Options | Default |
|--------|---------|---------|
| Project name | any string | — |
| Database driver | SQLite · PostgreSQL · MySQL | SQLite |
| Include Todo module? | yes / no | yes |
| Frontend frameworks | React · Vue · Solid (multiselect) | React |
| Primary framework | shown only when >1 framework selected | — |
| Add Tailwind CSS? | yes / no | yes |
| Add shadcn/ui? | yes / no (only if React + Tailwind) | yes |
| Install dependencies? | yes / no | yes |

## What gets generated

```
my-app/
├── bootstrap/
│   ├── app.ts          # Application.configure()...create()
│   └── providers.ts    # Ordered provider array
├── config/             # app, server, database, auth, session, queue, mail, cache, storage
├── app/
│   ├── Models/User.ts
│   ├── Providers/AppServiceProvider.ts
│   └── Middleware/RequestIdMiddleware.ts
├── routes/
│   ├── api.ts          # JSON API routes
│   ├── web.ts          # Web/redirect routes
│   └── console.ts      # Artisan commands
├── pages/
│   ├── +config.ts              # Root vike-photon config
│   ├── index/+config.ts        # Primary framework config
│   ├── index/+data.ts          # SSR data loader
│   ├── index/+Page.tsx|.vue    # Home page (primary framework)
│   ├── _error/+Page.tsx|.vue   # Error page (primary framework)
│   └── {fw}-demo/+Page.*       # Demo pages for secondary frameworks
├── app/Modules/Todo/           # (if Todo selected)
├── prisma/schema.prisma
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

When multiple frameworks are selected, secondary frameworks get a minimal demo page at `pages/{fw}-demo/`.

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
| Prisma generate | `pnpm exec prisma generate` | `npx prisma generate` | `yarn dlx prisma generate` | `bunx prisma generate` |
| Prisma db push | `pnpm exec prisma db push` | `npx prisma db push` | `yarn dlx prisma db push` | `bunx prisma db push` |
| Start dev server | `pnpm dev` | `npm run dev` | `yarn dev` | `bun dev` |

## Package manager differences in generated files

| File | pnpm | npm / yarn | bun |
|------|------|-----------|-----|
| `pnpm-workspace.yaml` | generated | not generated | not generated |
| `package.json` native-build field | `pnpm.onlyBuiltDependencies` | *(not needed)* | `trustedDependencies` |
