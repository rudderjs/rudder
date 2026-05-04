# create-rudder-app

**Spin up a production-ready [RudderJS](https://github.com/rudderjs/rudder) app in under 60 seconds** — with auth that works, a database wired, SSR views rendering, and your pick from 25 opt-in packages, all bootstrapped through Vite + Vike.

```bash
pnpm create rudder-app my-app
cd my-app
pnpm exec prisma generate && pnpm exec prisma db push
pnpm dev
# → http://localhost:3000 — welcome page + register/login working end-to-end
```

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

With the **default choices** (Prisma + SQLite + Auth + React + Tailwind + shadcn/ui + Contact demo), you get a working fullstack app you can register into, log into, and sign out of — without writing any code:

- **Welcome page at `/`** — controller-returned view, Tailwind + shadcn styled, with Log in / Register links or a signed-in user + Sign out button.
- **Auth flow that works** — `/login`, `/register`, `/forgot-password`, `/reset-password` pages vendored into `app/Views/Auth/` (so you can customize them freely) and wired to `POST /api/auth/sign-in/email` / `sign-up/email` / `sign-out` / `request-password-reset` / `reset-password` endpoints.
- **Database ready** — Prisma schema with a `User` + `PasswordResetToken` model, SQLite by default, a `User` ORM model.
- **Session-based auth** — cookie sessions via `@rudderjs/session`, `AuthMiddleware` applied to the `web` group, ghost-user-safe (see the [Request Lifecycle guide](https://github.com/rudderjs/rudder/blob/main/docs/guide/lifecycle.md)).
- **Rate limiting** — 60 req/min globally, 10 req/min on auth endpoints out of the box.
- **Bootstrap you can read** — `bootstrap/app.ts` in 25 lines, `bootstrap/providers.ts` shows auto-discovery, `config/` has one file per concern.
- **Rudder CLI** — `pnpm rudder --help` lists framework commands; `routes/console.ts` shows you how to add your own.
- **`/demos` index** — every demo you ticked appears as a card linking to its page; new demos picked up automatically from the shared registry.

If you tick **AI** you get a `/ai-chat` demo. If you tick **MCP**, `POST /mcp/echo`. If you tick **Passport**, a full OAuth 2 server at `/oauth/authorize` / `/oauth/token`. Everything is opt-in and pay-as-you-go.

---

## Prompts

The installer walks you through up to 10 prompts (several are conditional):

| # | Prompt | Options | Default | Condition |
|---|--------|---------|---------|-----------|
| 1 | Project name | any string | — | always (skipped if passed as argv) |
| 2 | Database ORM | Prisma · Drizzle · None | Prisma | always |
| 3 | Database driver | SQLite · PostgreSQL · MySQL | SQLite | only if ORM selected |
| 4 | Packages | categorized multiselect (see below) | Authentication | always |
| 5 | Frontend frameworks | React · Vue · Solid (multiselect) | React | always |
| 6 | Primary framework | single select from chosen frameworks | — | only if >1 framework selected |
| 7 | Add Tailwind CSS? | yes / no | yes | always |
| 8 | Add shadcn/ui? | yes / no | yes | only if React + Tailwind |
| 9 | Demos | multiselect filtered by previous picks | Contact form | only when at least one available |
| 10 | Install dependencies? | yes / no | yes | always |

> **Not sure what to pick?** Accept every default — it produces the most-used stack (Prisma + SQLite + Auth + React + Tailwind + shadcn/ui + Contact demo) and is the best-tested path. You can always add packages later.

### Tier A — silent install

`@rudderjs/session`, `@rudderjs/hash`, and `@rudderjs/cache` are installed unconditionally. They're required by the default bootstrap (rate-limit middleware needs cache; auth needs hash + session) so making them explicit-but-silent prevents broken projects when you don't tick Authentication.

### Package checklist (prompt 4)

Eight categories, 24 visible rows, one pre-checked. Picking ORM=none filters out the three DB-gated rows (Authentication, Sanctum, Passport). Category labels mirror the framework README.

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
- **Passport** — generates `config/passport.ts`, OAuth 2 routes (`/oauth/authorize`, `/oauth/token`, etc.), and `OAuthClient` + `OAuthAccessToken` Prisma models. Filtered out when ORM=none.

### Demos (prompt 9)

Each demo is a small view + one API endpoint, gated on the relevant package. The list is sourced from a single registry at `src/templates/demos/registry.ts` (also exported as `create-rudder-app/demos-registry` so the framework's own playground consumes it).

| Demo | Gate | What it shows |
|------|------|---------------|
| Contact form | always | CSRF + Zod validation, FormRequest-style errors |
| Cache counter | always | `Cache.get` + `Cache.set` round-trip |
| Todos | ORM | CRUD wired through ORM model + interactive UI |
| Queue dispatch | Queue | `ExampleJob.dispatch().send()` → handler logs |
| Mail send | Mail | `Mail.to(addr).send(new DemoMail(...))` via log driver |
| Notifications | Notifications + Mail | `notify(Notification.route('mail', addr), ...)` |
| Localization | Localization | locale switcher + `runWithLocale` + `trans()` |
| HTTP client | HTTP | `Http.retry(3, 200).timeout(5000).get(url)` against a public API |
| Avatar resize | Storage + Image | upload → 256×256 WebP via `@rudderjs/image` |
| Worker threads | Concurrency | sequential vs parallel `fib(n)` via `Concurrency.run()` |
| System info | Process | three shell commands via `Process.run()` and `Process.pool()` |
| Feature flags | Pennant + Auth | boolean / value / scoped / Lottery features + `FeatureMiddleware` |
| WebSocket chat | Broadcast | real-time chat + presence over a single WS |
| Yjs collaboration | Sync | CRDT live document with awareness cursors |

Demos are silently skipped when the primary framework isn't React (the templates ship React only for now).

Always-included base packages: `core`, `router`, `server-hono`, `middleware`, `vite`, `console`, `cli`, `log`, plus the Tier A trio above.

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

When you let the installer run **Install dependencies**, it also runs `rudder providers:discover` automatically so the app boots on first `dev`. If you skipped install, run both manually before `dev`.

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

Usually means the schema wasn't pushed. Run:

```bash
pnpm exec prisma generate
pnpm exec prisma db push
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
pnpm test                                       # 169 template tests + snapshot baseline
pnpm smoke                                      # default end-to-end smoke
pnpm smoke --profile=no-db                      # ORM=none + observability survivability
pnpm smoke --profile=demos-all                  # every demo at once
```

Template logic lives in `src/templates.ts` (pure — returns `Record<path, content>`, no filesystem) plus modular `src/templates/{configs,demos,prisma,…}/`. The entrypoint `src/index.ts` handles prompts + writes + installs. Adding a new package option touches `templates/configs/`, `templates/package-json.ts`, and `src/index.ts`. Adding a new demo means one entry in `src/templates/demos/registry.ts` plus a per-demo template module — the playground's `/demos` index picks it up automatically via the `create-rudder-app/demos-registry` subpath export.

---

## License

MIT © [Suleiman Shahbari](https://github.com/rudderjs/rudder)
