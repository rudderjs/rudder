# create-rudder

> This file is read on-demand by Claude Code when working on the scaffolder.
> For the always-loaded essentials, see `/CLAUDE.md`.

---

## Prompts (recipe-driven, cascade-aware, in order)

1. Project name — skipped if passed as argv
2. **What are you building?** — `web-app` (default) · `saas` · `api-service` · `realtime` · `minimal` · `custom`. Single-select recipe picker that drives the next prompts.
3. Database ORM — **Native** (default, pre-highlighted) · Prisma · Drizzle (+ **None** when recipe is `minimal` or `custom`). Native is the built-in engine (`@rudderjs/database`, re-exported at `@rudderjs/orm/native`).
4. Database driver — SQLite (default) · PostgreSQL · MySQL — asked for every engine, Native included (7.9). Native maps the choice to its driver names (`sqlite`/`pg`/`mysql`) and adds the driver dep (`better-sqlite3`/`postgres`/`mysql2`).
5. **Packages** — categorized multiselect (8 sections, 25 visible rows, Authentication pre-checked). **Only shown for recipe = `custom`.** When ORM=None, the three DB-gated rows (Authentication, Sanctum, Passport) are hidden — Socialite stays.
6. Frontend framework — single select: React (default) · Vue · Solid · None. Skipped for recipe = `api-service` or `minimal`. Multi-framework picks live behind the legacy `--frameworks` flag only.
7. Styling — single select: Tailwind+shadcn (default for React) · Tailwind · Plain CSS. Skipped when no framework / API service / Minimal. shadcn row only shown for React.
8. Is your DB running now? — yes/no — **only when DB is Postgres/MySQL** (any engine). If no, the auto-cascade skips `db:push` (Prisma/Drizzle) / `migrate` (Native) and adds it to the manual steps panel.
9. Install and run setup? — yes/no (default yes). When yes, the post-install cascade fires (see below).

### Recipe → preset map
Lives in `src/cli-flags.ts` as the `RECIPES` constant:

| Recipe | Packages preset | needsOrm | needsFrontend |
|---|---|---|---|
| `web-app` | `auth` | true | true |
| `saas` | `auth, queue, mail, notifications` | true | true |
| `api-service` | `auth, http` | true | false |
| `realtime` | `auth, broadcast, sync` | true | true |
| `minimal` | *(none beyond Tier A)* | false | false |
| `custom` | *(user picks via multiselect)* | optional | optional |

### Tier A silent install
`@rudderjs/session`, `@rudderjs/hash`, `@rudderjs/cache` are always installed (no checkbox). They're required by the default bootstrap (rate-limit middleware needs cache; auth needs hash + session).

### Package categories (custom recipe — prompt 5)

```
Auth & Security      — auth, sanctum, passport, socialite, crypt
Infrastructure       — queue, storage, scheduler
Communication        — mail, notifications, broadcast, sync
Internationalization — localization
Developer Experience — pennant, http, process, concurrency, terminal
Media                — image
Observability        — telescope, pulse, horizon
AI & Tooling         — ai, mcp, boost
```

Package-specific scaffolded behavior:
- `ai` → `config/ai.ts`, `ai()` provider, AI chat demo at `/ai-chat`, `POST /api/ai/chat`
- `mcp` → `app/Mcp/EchoServer.ts` + `EchoTool.ts` + `POST /mcp/echo`
- `passport` → full OAuth 2 server (filtered out under ORM=none); auto-cascade runs `passport:keys` to generate the RSA keypair
- `auth` → vendors `@rudderjs/auth/views/<framework>/*` into `app/Views/Auth/` via `fs.cp`; auto-cascade runs `vendor:publish --tag=auth-views-*` only if that fallback was needed

### Post-install auto-cascade

When `--install=true` (default), after `pnpm install` + `pnpm rudder providers:discover`, the scaffolder also runs:

1. `pnpm rudder db:generate` — when ORM is Prisma/Drizzle (no-op for Drizzle). **Skipped for Native** (no client to generate; db:generate/db:push throw for native).
2. `pnpm rudder db:push` — when `dbReady=true` (SQLite default; Postgres/MySQL only if user confirmed). **For Native, runs `pnpm rudder migrate` instead** (same `dbReady` gating) — applies the scaffolded `database/migrations/*` (creates dev.db on sqlite / runs DDL on the live pg/mysql + the typed `.rudder/types/models.d.ts`). `dbPushOk` carries the migrate result.
3. `pnpm rudder vendor:publish --tag=auth-views-<framework>` — only when auth was selected AND `fs.cp` couldn't vendor the views
4. `pnpm rudder passport:keys` — only when passport selected
5. `git init` + `git add . && git commit -m "Initial commit (create-rudder)"` — controlled by `--git=true|false`, default true

These rely on @rudderjs/cli having the matching commands in its **skip-boot list** (`db:generate`, `db:push`, `migrate*` were added in PR #519's bundled cli fix; `add`/`remove` were added in #520/#521). Without skip-boot, `rudder db:generate` would try to boot the app before `@prisma/client` exists and crash — that's why the framework fix is load-bearing for the scaffolder's first 60-second story.

### Post-scaffold diagnostics

A scaffolded app that doesn't `pnpm dev` cleanly has a known failure surface — missing env var, stale providers manifest, Prisma client behind the schema, auth views not vendored. **`pnpm rudder doctor`** pre-flights all of them in sub-second and prints a one-line fix per failure. When the user reports "the scaffolded app won't start", `cd my-app && pnpm rudder doctor` is the first thing to ask them to paste — same output across every recipe. See [`docs/guide/doctor.md`](../docs/guide/doctor.md) for the full check list.

### What about demos?

**Dropped from the default scaffolder** (PR #519). The 15-demo multiselect is gone; no `app/Views/Demos/` folder is generated. Demos still exist in the framework `playground/` (canonical reference app). The original PR copy mentioned `rudderjs.com/examples` but that URL has never shipped — the scaffolder's final panel now links to the GitHub playground tree directly.

`src/templates/demos/registry.ts` still exists as a subpath export (`create-rudder/demos-registry`) so the playground continues to consume the same DemoSpec metadata for its own gallery. The scaffolder's template pipeline still accepts a `demos: string[]` field on `TemplateContext`, but the interactive flow always passes `[]`. The `--demos` flag is preserved as a silent no-op for backwards compatibility.

---

## Non-interactive / JSON mode

Inspired by Laravel Installer v5.27. When run inside an AI coding agent the prompts degrade to garbage, so the scaffolder switches to a flag-driven mode and emits a single line of JSON to stdout (logs go to stderr).

**Triggers** — any of:
- Detected agent env var: `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CURSOR_TRACE_ID`, `TERM_PROGRAM=cursor`, `GITHUB_COPILOT_CLI`, `CODEX_CLI`, `OPENAI_CODEX`, `GEMINI_CLI`, `WINDSURF_AGENT`, `WINDSURF`
- `RUDDER_NONINTERACTIVE=1` (CI / scripting)
- `--json` flag
- `--interactive` overrides all of the above

**Required flags in JSON mode** — two valid call shapes:

**Recipe shortcut** (preferred for new scripts):
```
<project-name>
--recipe=web-app|saas|api-service|realtime|minimal|custom
--orm=native|prisma|drizzle|none       (optional — default native, matching the interactive prompt)
--db=sqlite|postgresql|mysql           (optional — defaults to sqlite; works with every engine. Only required with an explicit --orm=prisma|drizzle. Since 7.9, --db=postgresql|mysql without --orm stays on the native default — the pre-7.9 Prisma fallback is gone)
--framework=react|vue|solid|none       (omit when recipe doesn't need frontend)
--styling=tailwind+shadcn|tailwind|plain  (optional, defaults to recipe-appropriate)
--packages=...                         (only when --recipe=custom)
--db-ready=true|false                  (optional — pre-answers the Postgres/MySQL prompt; defaults to true for SQLite, false otherwise)
--git=true|false                       (optional, default true)
--install=true|false
```

**Legacy explicit** (pre-recipe contract; still supported for older scripts/CI):
```
<project-name>
--orm=prisma|drizzle|none
--db=sqlite|postgresql|mysql           (omit when --orm=none)
--packages=auth,queue,...              ('*' = all defaults; '' = none)
--frameworks=react,vue,solid           (comma-separated)
--primary-framework=react|vue|solid    (only when >1 framework)
--tailwind=true|false
--shadcn=true|false                    (only when react + tailwind=true)
--install=true|false
```

The `--demos` flag still parses but is a silent no-op (demos were dropped from the scaffolder default).

**Output**:
```jsonc
// success — the auto-cascade fields appear only when --install=true and each
// step was attempted (null = skipped, true/false = ran with that result)
{
  "success": true, "name": "my-app", "directory": "/abs/path", "files": 36,
  "agent": "claude-code",
  "installed": true, "providersDiscovered": true,
  "dbGenerated": true, "dbPushed": true,
  "authViewsPublished": null,        // null = fs.cp succeeded, no fallback needed
  "passportKeysGenerated": null,     // null = passport not selected
  "gitInitialized": true
}

// missing flags (exit 1)
{ "success": false, "error": "Missing required flags...", "requiredFlags": ["--recipe", "--db"], "agent": "claude-code" }

// install crash (exit 1)
{ "success": false, "error": "...", "logFile": "/tmp/cra-xxx.log", "logTail": "...", "agent": "claude-code" }
```

Flags also work in interactive mode — passing `--orm=prisma` skips that prompt. This makes the scaffolder scriptable for templates and CI without forcing JSON output.

Detection logic lives in `src/agent-detect.ts`; flag parsing + validation in `src/cli-flags.ts` (kept separate from `index.ts` so tests can import without triggering `main()`).

---

## Package Manager Support

PM is auto-detected from `npm_config_user_agent` (set by pnpm/npm/yarn/bun when invoking the installer).

| | pnpm | npm | yarn | bun |
|---|---|---|---|---|
| `pnpm-workspace.yaml` | generated | no | no | no |
| native-build field | `pnpm.onlyBuiltDependencies` | *(none needed)* | *(none needed)* | `trustedDependencies` |
| exec | `pnpm exec <bin>` | `npx <bin>` | `yarn dlx <bin>` | `bunx <bin>` |
| run | `pnpm <script>` | `npm run <script>` | `yarn <script>` | `bun <script>` |

Helpers: `detectPackageManager()`, `pmExec(pm, bin)`, `pmRun(pm, script)`, `pmInstall(pm)` — exported from `templates/package-managers.ts`, re-exported from `templates.ts`.

---

## Module layout (Phase 1 split)

`templates.ts` is a thin re-exports + `getTemplates()` orchestrator (~250 lines). Everything else lives under `src/templates/`:

```
templates/
├── package-managers.ts    package-json.ts    tsconfig.ts    vite.ts    env.ts    server.ts
├── prisma/                # base, auth, notification, passport, modules
├── native/                # native-engine scaffolds (create-users-migration) —
│                          #   only emitted for orm=native + auth
├── css/                   # index dispatcher + tailwind + plain variants
├── bootstrap/             # app, providers
├── configs/               # one file per config (app, server, log, hash, database, queue, mail, …)
├── app/                   # user-model, auth-controller, mcp-{server,tool}, service-provider
├── routes/                # api, web, console
├── pages/                 # index, error, ai-chat (per framework)
├── views/                 # welcome (per framework)
└── demos/                 # registry + per-demo template modules — kept for the
                            #   `create-rudder/demos-registry` subpath export consumed
                            #   by the framework playground. Not scaffolded by default
                            #   (templates pipeline still accepts demos: string[] but the
                            #   interactive + recipe flows always pass []).
```

---

## Template Gotchas

- `tsconfig.json` must be self-contained — no `extends: ../tsconfig.base.json` (monorepo-only)
- All `@rudderjs/*` deps use `'latest'` — pnpm double-zero semver (`^0.0.x`) pins to exact version
- Native-build field in `package.json` is PM-specific (see table above)
- Use `database(configs.database)` from `@rudderjs/orm-prisma` not `DatabaseServiceProvider` in providers.ts
- `shadcn` dep only added when React + Tailwind are both selected
- `src/index.css` is always generated when Tailwind is on, otherwise hand-authored. Same semantic class selectors in both (`.page`, `.feature-card`, `.auth-card`, `.todo-list`, `.chat-bubble`, `.demo-card`, …) so JSX never branches on the flag — demos work without Tailwind
- React + Solid together: Vite plugins use `include`/`exclude` to disambiguate `.tsx` files
- Secondary frameworks get demo pages at `pages/{fw}-demo/` (each with its own `+config.ts`)
- WebSocket (broadcast) demo ships `src/RudderSocket.ts` — vendored client helper, not exported via `@rudderjs/broadcast` package.json
- `app/Http/` namespace: controllers and middleware live under `app/Http/Controllers/` and `app/Http/Middleware/`. The legacy `RequestIdMiddleware` was dropped; nothing scaffolds into a top-level `app/Middleware/` anymore
- `@rudderjs/session` is always in deps (Tier A) — providers.ts imports via `defaultProviders()`
- `@rudderjs/hash` is always in deps (Tier A) — required peer of auth, useful standalone
- `@rudderjs/cache` is always in deps (Tier A) — bootstrap registers `RateLimit.perMinute(60)` middleware which requires cache

---

## Vike +server.ts Strategy
- **All apps**: `+server.ts` is generated at the **project root**, wiring `bootstrap/app.ts` to Vike via `@vikejs/hono`. The file exports `{ fetch: app.fetch }` satisfying Vike's `Server` type.
- **Single framework**: renderer (`vike-react`/`vike-vue`/`vike-solid`) included in root `pages/+config.ts`. No `pages/index/+config.ts` generated.
- **Multi-framework**: root `pages/+config.ts` has no renderer. Each page/folder has its own `+config.ts` extending the correct renderer. `pages/index/+config.ts` is generated for the primary framework.
- **Config style**: All `+config.ts` files use `satisfies Config` (not `as unknown as Config`).
- **No vike-photon**: The old `vike-photon` package is no longer used. `@vikejs/hono` replaces it.

---

## Provider Auto-Discovery

Providers are loaded via `defaultProviders()` reading `bootstrap/cache/providers.json`. The scaffolder runs `rudder providers:discover` automatically on `--install`. The manifest is gitignored.

Foundation → infrastructure → feature → monitoring stages run in order; `depends` resolves within each stage. App-level provider (`AppServiceProvider`) is spread last in the array.

---

## Local Testing

```bash
cd create-rudder
pnpm build
node dist/index.js                          # launches the full interactive CLI

pnpm test                                   # template tests + snapshot baseline
pnpm smoke                                  # default profile (web-app — Prisma + auth + react)
pnpm smoke --profile=native                 # built-in native engine (SQLite) + auth + react — runs `rudder migrate`
pnpm smoke --profile=native-pg              # native engine on live Postgres — needs PG_TEST_URL (or DATABASE_URL)
pnpm smoke --profile=minimal                # no packages, no ORM, no frontend (vanilla welcome)
pnpm smoke --profile=saas                   # web-app + queue + mail + notifications
pnpm smoke --profile=api-service            # auth + http, no frontend
pnpm smoke --profile=realtime               # web-app + broadcast + sync
pnpm smoke --framework=vue                  # swap the frontend renderer
pnpm smoke --via=cli                        # spawn the real CLI binary instead of getTemplates()
pnpm smoke --pm=npm                         # swap the package manager (npm, yarn)
pnpm smoke --keep                           # don't delete the tmp dir on success
```

Smoke profiles mirror the `RECIPES` constant in `src/cli-flags.ts` — keep them in sync when recipes change.

**E2E coverage**: 9 cells per-PR (5 react recipes × direct + 2 vue/solid web-app × direct + 1 react/web-app × cli + 1 react/web-app × npm) plus a weekly canary against the published packages (`.github/workflows/scaffolder-canary.yml`).

**Package-manager dimension**: pnpm is the per-recipe baseline; the `+ 1 react/web-app × npm` cell catches PM-specific install / exec / script regressions. The smoke is PM-aware in three places — install command (`pnpm install` vs `npm install` vs `yarn install`), exec command (`pnpm exec X` vs `npm exec -- X` vs `yarn exec -- X`), and `@rudderjs/*` linking strategy. For pnpm the linking is `link:` symlinks; for npm + yarn the smoke runs `pnpm -r pack` once + installs from packed tarballs (matches what published-registry installs look like). yarn classic (1.x) has a known hoister bug with vike + vite (see `feedback_yarn1_vike_hoist_bug` in memory) — yarn berry coverage with `nodeLinker: node-modules` is a follow-up.

**Snapshot baseline**: `templates.snapshot.test.ts` asserts file count + total bytes + content hash + sorted paths. After a deliberate template-output change run `pnpm exec tsx scripts/recapture-snapshot.ts` and paste the new values into the test.

**Fresh-worktree gotcha**: `pnpm smoke` (the default, pnpm path) needs the workspace's playground Prisma client generated once before it works:

```bash
cd playground && pnpm exec prisma generate
```

Without it, the smoke's `command:list` boot step fails with `Cannot find module '.prisma/client/default'` (the pnpm path uses `link:` overrides into the workspace's `node_modules`, which shares a Prisma client cache). `--pm=npm` doesn't need this — packed tarballs carry their own resolved deps.
