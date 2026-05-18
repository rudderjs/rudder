# create-rudder-app

**Spin up a production-ready [RudderJS](https://github.com/rudderjs/rudder) app in under 60 seconds** — pick a recipe, the installer handles deps, database, auth views, and git init for you.

```bash
pnpm create rudder-app my-app
cd my-app && pnpm dev
# → http://localhost:3000 — welcome page + register/login working end-to-end
```

The installer asks four to six questions, then runs `pnpm install`, generates the Prisma client, pushes the schema (for SQLite) or asks first (for Postgres/MySQL), publishes auth views, generates Passport keys (when selected), and initializes git — all in one shot. No copy-pasting commands from the "Next Steps" panel.

---

## Install

All four major package managers work. The installer detects which one you used and adapts every generated file, install command, and post-scaffold hint.

```bash
pnpm create rudder-app [name]
npm create rudder-app@latest [name]
yarn create rudder-app [name]
bunx create-rudder-app [name]
```

Skip `[name]` to be prompted for one.

---

## What you get out of the box

With the **Web app recipe** (Prisma + SQLite + Auth + React + Tailwind + shadcn/ui), you get a working fullstack app you can register into, log into, and sign out of — without writing any code:

- **Welcome page at `/`** — controller-returned view, Tailwind + shadcn styled, with Log in / Register links or a signed-in user + Sign out button.
- **Auth flow that works** — `/login`, `/register`, `/forgot-password`, `/reset-password` pages vendored into `app/Views/Auth/` (so you can customize them freely) and wired to `POST /auth/sign-in/email` / `sign-up/email` / `sign-out` / `request-password-reset` / `reset-password` endpoints.
- **Database ready** — Prisma schema with a `User` + `PasswordResetToken` model, SQLite by default, a `User` ORM model. Schema pushed automatically on install.
- **Session-based auth** — cookie sessions via `@rudderjs/session`, `AuthMiddleware` applied to the `web` group, ghost-user-safe (see the [Request Lifecycle guide](https://github.com/rudderjs/rudder/blob/main/docs/guide/lifecycle.md)).
- **Rate limiting** — 60 req/min globally, 10 req/min on auth endpoints out of the box.
- **Bootstrap you can read** — `bootstrap/app.ts` in 25 lines, `bootstrap/providers.ts` shows auto-discovery, `config/` has one file per concern.
- **Rudder CLI** — `pnpm rudder --help` lists framework commands; `routes/console.ts` shows you how to add your own.
- **Git initialized** — initial commit made for you (use `--git=false` to skip).

Pick the **SaaS recipe** and you also get queue + mail + notifications. **Realtime** adds broadcast + sync. **API service** drops the frontend entirely. **Custom** lets you check exactly the packages you want from the full 25-package menu.

---

## Prompts

The installer asks at most six questions on the happy path:

| # | Prompt | Options | Default | Condition |
|---|--------|---------|---------|-----------|
| 1 | Project name | any string | — | always (skipped if passed as argv) |
| 2 | What are you building? *(recipe)* | Web app · SaaS · API service · Realtime · Minimal · Custom | Web app | always |
| 3 | Database | Prisma · Drizzle *(+ None for Minimal/Custom)* | Prisma | unless recipe is `minimal` |
| 4 | Database driver | SQLite · PostgreSQL · MySQL | SQLite | only when an ORM is selected |
| 5 | Frontend framework | React · Vue · Solid · None | React | unless recipe is `api-service`/`minimal` |
| 6 | Styling | Tailwind+shadcn · Tailwind · Plain CSS | Tailwind+shadcn (React) / Tailwind (Vue/Solid) | only when a framework is selected |
| 7 | Is your DB running now? | yes / no | yes | only for PostgreSQL/MySQL |
| 8 | Install and run setup? | yes / no | yes | always |

> **Not sure what to pick?** Accept every default — Web app with Prisma + SQLite + React + Tailwind + shadcn/ui is the best-tested path. You can [add packages later](#adding-packages-later).

### Recipes (prompt 2)

| Recipe | Adds on top of the framework core | Needs ORM | Needs frontend |
|---|---|---|---|
| **Web app** *(default)* | `auth` | yes | yes |
| **SaaS** | `auth` + `queue` + `mail` + `notifications` | yes | yes |
| **API service** | `auth` + `http` | yes | no |
| **Realtime** | `auth` + `broadcast` + `sync` | yes | yes |
| **Minimal** | nothing beyond the framework core | no | no |
| **Custom** | *(prompts you with the full 25-package multiselect)* | optional | optional |

Each recipe is a curated bundle. **Custom** is the escape hatch — if you want a specific mix, pick Custom and select exactly the packages you want from the legacy multiselect (8 categories, 25 packages).

### Tier A — silent install

`@rudderjs/session`, `@rudderjs/hash`, and `@rudderjs/cache` are installed unconditionally. They're required by the default bootstrap (rate-limit middleware needs cache; auth needs hash + session) so making them explicit-but-silent prevents broken projects when you don't tick Authentication.

### Custom recipe — full package list

```
─── Auth & Security ───
  Authentication              login, register, sessions
  Sanctum                     API tokens (SHA-256 + abilities)
  Passport                    OAuth 2 server — requires Auth + Prisma
  Socialite                   social login (GitHub, Google, Facebook, Apple)
  Crypt                       AES-256-CBC + HMAC encryption

─── Infrastructure ───
  Queue                       background jobs
  Storage                     file uploads (local + S3)
  Scheduler                   cron-like task scheduling

─── Communication ───
  Mail                        SMTP + log driver
  Notifications               multi-channel
  WebSocket / Broadcast       real-time channels
  Sync (Yjs CRDT)             collaborative documents

─── Internationalization ───
  Localization                i18n — trans(), setLocale()

─── Developer Experience ───
  Pennant                     feature flags
  HTTP                        fluent fetch client (retries, timeouts, pools)
  Process                     shell execution (run, pool, pipe)
  Concurrency                 parallel execution via worker threads

─── Media ───
  Image                       resize, crop, convert (sharp wrapper)

─── Observability ───
  Telescope                   debug dashboard
  Pulse                       metrics dashboard
  Horizon                     queue monitoring

─── AI & Tooling ───
  AI                          11 LLM providers (Anthropic, OpenAI, …)
  MCP                         Model Context Protocol — expose tools to LLMs
  Boost                       AI coding DX (Claude Code / Cursor / Copilot)
```

Package-specific behavior:

- **AI** — generates `config/ai.ts`, AI chat demo at `/ai-chat`, `POST /api/ai/chat`.
- **MCP** — generates `app/Mcp/EchoServer.ts` + `EchoTool.ts` and wires `POST /mcp/echo`.
- **Passport** — generates `config/passport.ts`, OAuth 2 routes (`/oauth/authorize`, `/oauth/token`, etc.), and `OAuthClient` + `OAuthAccessToken` Prisma models. Filtered out when ORM=none. The installer runs `pnpm rudder passport:keys` automatically to generate the RSA keypair.

Always-included base packages: `core`, `router`, `server-hono`, `middleware`, `vite`, `console`, `cli`, `log`, plus the Tier A trio above.

### What about demos?

Demos are no longer scaffolded into your project — they live in the [framework playground](https://github.com/rudderjs/rudder/tree/main/playground), the canonical "what can RudderJS do?" gallery with every package wired up. The previous "demos multiselect" added 1–15 demo pages under `app/Views/Demos/`; new users found that confusing ("is this my code?") and easy to forget to delete before deploying. The trade-off in favor of a clean scaffold won out.

If you want a guided tour, the playground runs every demo at once and is meant to be cloned + explored.

---

## Generated structure

```
my-app/
├── bootstrap/
│   ├── app.ts          # Application.configure()...create()
│   └── providers.ts    # [...(await defaultProviders()), ...app providers]
├── config/             # app, server, log + per-package configs (auth, cache, session, …)
├── app/
│   ├── Http/Controllers/AuthController.ts   # (if Auth)
│   ├── Models/User.ts                        # (if Auth)
│   ├── Views/                                # (if Auth) Welcome + Auth/{Login,Register,...} vendored
│   │                                         # + Demos/<picked>.tsx
│   ├── Mcp/{EchoServer,EchoTool}.ts          # (if MCP)
│   ├── Modules/Todo/                         # (if Todos demo)
│   ├── Jobs/ExampleJob.ts                    # (if Queue demo)
│   ├── Mail/DemoMail.ts                      # (if Mail demo)
│   ├── Notifications/WelcomeNotification.ts  # (if Notifications demo)
│   └── Providers/AppServiceProvider.ts
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
│   └── modules.prisma          #   per-feature module schemas (Todo, …)
├── drizzle/                    # (if Drizzle) schema directory
├── lang/{en,es,ar}/            # (if Localization demo) message files
├── src/
│   ├── index.css               # (if Tailwind) — semantic classes work without Tailwind too
│   └── RudderSocket.ts         # (if Broadcast) — vendored client helper
├── vite.config.ts
├── tsconfig.json
├── .env + .env.example
└── package.json
```

---

## Reference — framework combinations, CSS, PM differences

<details>
<summary>Framework selection → page extension + tsconfig</summary>

| Selection | Page extension | tsconfig jsx |
|-----------|---------------|--------------|
| React only | `.tsx` | `react-jsx` |
| Vue only | `.vue` | *(omitted)* |
| Solid only | `.tsx` | `preserve` + `jsxImportSource: solid-js` |
| React + Vue | `.tsx` (React primary) | `react-jsx` |
| React + Solid | `.tsx` — Vite plugins use include/exclude to disambiguate | `react-jsx` |
| All three | `.tsx` or `.vue` depending on primary | `react-jsx` |

**Single framework:** the renderer (`vike-react`, `vike-vue`, or `vike-solid`) is included directly in the root `+config.ts`.

**Multiple frameworks:** the root `+config.ts` has no renderer. Each page folder declares its own `+config.ts` extending the appropriate renderer. Secondary frameworks get a minimal demo page at `pages/{fw}-demo/`.
</details>

<details>
<summary>CSS variants based on Tailwind / shadcn selection</summary>

| Selection | `src/index.css` content |
|-----------|------------------------|
| Tailwind + shadcn | shadcn CSS variables + `@import "shadcn/tailwind.css"` + semantic-class `@apply` rules |
| Tailwind only | `@import "tailwindcss"; @import "tw-animate-css";` + semantic-class `@apply` rules |
| No Tailwind | hand-authored CSS — same semantic class names so JSX never branches on the flag |

Demos use the same semantic class vocabulary across all three variants — `.page`, `.feature-card`, `.form-input`, `.demo-card`, `.chat-bubble`, etc. — so they look right whether or not you ship Tailwind.
</details>

<details>
<summary>Package-manager differences in generated files</summary>

| File | pnpm | npm / yarn | bun |
|------|------|-----------|-----|
| `pnpm-workspace.yaml` | generated | not generated | not generated |
| `package.json` native-build field | `pnpm.onlyBuiltDependencies` | *(not needed)* | `trustedDependencies` |
</details>

---

## After scaffolding

When **Install and run setup** is `yes` (the default), the installer runs the whole cascade for you — `pnpm install`, `rudder providers:discover`, `rudder db:generate`, `rudder db:push` (for SQLite, or after confirming for Postgres/MySQL), `rudder vendor:publish --tag=auth-views-*` (if needed), `rudder passport:keys` (when Passport is selected), and `git init` + an initial commit. On the happy path the final panel says exactly one thing:

```
cd my-app && pnpm dev
```

If you said **no** to install, or a cascade step failed (e.g. your Postgres wasn't reachable), the panel prints only the steps you still need to run manually. Common ones:

| Step | pnpm | npm | yarn | bun |
|------|------|-----|------|-----|
| Install | `pnpm install` | `npm install` | `yarn install` | `bun install` |
| Discover providers | `pnpm rudder providers:discover` | `npm run rudder providers:discover` | `yarn rudder providers:discover` | `bun rudder providers:discover` |
| DB schema | `pnpm rudder db:push` | `npm run rudder db:push` | `yarn rudder db:push` | `bun rudder db:push` |
| Generate client (Prisma) | `pnpm rudder db:generate` | `npm run rudder db:generate` | `yarn rudder db:generate` | `bun rudder db:generate` |
| Publish auth views | `pnpm rudder vendor:publish --tag=auth-views-react` | `npm run rudder vendor:publish --tag=auth-views-react` | `yarn rudder vendor:publish --tag=auth-views-react` | `bun rudder vendor:publish --tag=auth-views-react` |
| Passport keys | `pnpm rudder passport:keys` | `npm run rudder passport:keys` | `yarn rudder passport:keys` | `bun rudder passport:keys` |
| Start dev server | `pnpm dev` | `npm run dev` | `yarn dev` | `bun dev` |

## Adding packages later

Scaffolding gives you a minimal default. When you want to grow:

```bash
pnpm rudder add queue        # installs @rudderjs/queue, generates config/queue.ts,
                             #   wires it into config/index.ts, refreshes the manifest

pnpm rudder add ai           # ANTHROPIC_API_KEY etc. — see the printed hint
pnpm rudder add telescope    # debug dashboard at /telescope
pnpm rudder add passport     # validates: passport requires auth + Prisma

pnpm rudder remove queue     # uninstall + delete config/queue.ts + unregister
```

Both commands are **idempotent** — re-running is safe. `add` refuses to overwrite an existing config file. `remove` refuses to break the dep graph (e.g. removing `auth` while `sanctum`/`passport` are installed prints a friendly error). See the [CLI guide](https://github.com/rudderjs/rudder/blob/main/docs/guide/rudder.md) for the full list of aliases.

---

## Troubleshooting

<details>
<summary><strong>“[RudderJS] @rudderjs/X listed in the provider manifest but not installed”</strong></summary>

The auto-discovery manifest (`bootstrap/cache/providers.json`) references a package you no longer have. Regenerate:

```bash
pnpm rudder providers:discover
```
</details>

<details>
<summary><strong>Register or login returns 500 with a Prisma error</strong></summary>

Usually means the schema wasn't pushed. The installer normally does this for you on SQLite, and after you confirm "Is your DB running?" for Postgres/MySQL. To run it yourself:

```bash
pnpm rudder db:generate
pnpm rudder db:push
```
</details>

<details>
<summary><strong>Passport endpoints 500 with “no private key found”</strong></summary>

You skipped the key generation step. Run:

```bash
pnpm rudder passport:keys
```

Keys land in `storage/oauth-{private,public}.key`. They're gitignored — never commit them.
</details>

<details>
<summary><strong>Port 3000 or HMR port 24678 already in use</strong></summary>

```bash
lsof -ti :24678 -ti :3000 | xargs kill -9
```
</details>

<details>
<summary><strong>Auth views didn't get copied — “run vendor:publish manually”</strong></summary>

The installer tries to vendor `@rudderjs/auth/views/{react,vue}/` into `app/Views/Auth/`. If the copy fails (rare), run:

```bash
pnpm rudder vendor:publish --tag=auth-views-react   # or auth-views-vue
```
</details>

<details>
<summary><strong>APP_KEY length error after enabling Crypt</strong></summary>

`@rudderjs/crypt` requires exactly 32 bytes for AES-256. The scaffolder generates a valid key in `.env` but if you replace it, make sure the base64-decoded value is 32 bytes:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
</details>

---

## Related

- **Main framework**: [github.com/rudderjs/rudder](https://github.com/rudderjs/rudder)
- **Docs**: [Request Lifecycle](https://github.com/rudderjs/rudder/blob/main/docs/guide/lifecycle.md) · [Service Providers](https://github.com/rudderjs/rudder/blob/main/docs/guide/service-providers.md) · [Installation](https://github.com/rudderjs/rudder/blob/main/docs/guide/installation.md)
- **Report issues**: [github.com/rudderjs/rudder/issues](https://github.com/rudderjs/rudder/issues)

---

## Contributing to the scaffolder

```bash
git clone https://github.com/rudderjs/rudder.git
cd rudder/create-rudder-app
pnpm install
pnpm build
node dist/index.js                              # launches the interactive CLI from source
pnpm test                                       # template tests + snapshot baseline
pnpm smoke                                      # default end-to-end smoke
pnpm smoke --profile=minimal                    # ORM=none + nothing else
pnpm smoke --profile=no-db                      # ORM=none + observability survivability
```

Template logic lives in `src/templates.ts` (pure — returns `Record<path, content>`, no filesystem) plus modular `src/templates/{configs,prisma,…}/`. The entrypoint `src/index.ts` handles prompts + writes + the post-install cascade. Adding a new package option touches `templates/configs/`, `templates/package-json.ts`, and the `PACKAGE_GROUPS` map in `src/index.ts`. Adding a new recipe touches the `RECIPES` map in `src/cli-flags.ts` and (if a new prompt arm is needed) `src/index.ts`.

---

## License

MIT © [Suleiman Shahbari](https://github.com/rudderjs/rudder)
