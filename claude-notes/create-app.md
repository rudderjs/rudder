# create-rudder-app

> This file is read on-demand by Claude Code when working on the scaffolder.
> For the always-loaded essentials, see `/CLAUDE.md`.

---

## Prompts (cascade-aware, in order)

1. Project name — skipped if passed as argv
2. Database ORM — Prisma · Drizzle · **None**
3. Database driver — SQLite · PostgreSQL · MySQL — only when ORM ≠ None
4. **Packages** — categorized multiselect (8 sections, 25 visible rows, Authentication pre-checked). When ORM=None, `Auth & Users` (Authentication, Sanctum, Passport) and `Cashier-Paddle` rows are filtered out — Socialite stays
5. Frontend frameworks — multiselect: React · Vue · Solid (default React)
6. Primary framework — single select, only when >1 framework picked
7. Add Tailwind CSS? — yes/no (default yes)
8. Add shadcn/ui? — yes/no (default yes), only when React + Tailwind
9. **Demos** — multiselect filtered by selected packages (default Contact form). Only shown when at least one demo is available
10. Install dependencies? — yes/no

### Tier A silent install
`@rudderjs/session`, `@rudderjs/hash`, `@rudderjs/cache` are always installed (no checkbox). They're required by the default bootstrap (rate-limit middleware needs cache; auth needs hash + session).

### Package categories (prompt 4)

```
Auth & Users     — auth, sanctum, passport, socialite
Infrastructure   — queue, storage, scheduler, image
Communication    — mail, notifications, broadcast, sync
AI               — ai, mcp, boost
i18n             — localization
Product          — cashier-paddle, pennant
Observability    — telescope, pulse, horizon
Utilities        — crypt, http, process, concurrency
```

When `ai` is selected: `config/ai.ts`, `ai()` provider, AI chat demo at `/ai-chat`, `POST /api/ai/chat`. When `mcp` is selected: `app/Mcp/EchoServer.ts` + `EchoTool.ts` + `POST /mcp/echo`. When `passport` is selected: full OAuth 2 server (filtered out under ORM=none). `@rudderjs/log` is always a base dep.

### Demos (prompt 9)

Source of truth: `src/templates/demos/registry.ts` — exports `DEMOS: ReadonlyArray<DemoSpec>` plus `availableDemos(orm, packages)`, `demoHref(spec)`, `demoTitle(spec)` helpers. The list is also published as a subpath export (`create-rudder-app/demos-registry`) so the framework's playground consumes the same data without duplicating descriptions.

`DemoSpec` shape: `{ value, label, hint?, title?, description, packages, requires?, requiresOrm? }`. `label` is the multiselect row, `title` is the optional card title (falls back to `label`), `description` is the long card text, `packages` is the `@rudderjs/*` chip list under the card.

14 demos as of 2026-05-03: contact, cache (always); todos (ORM); queue, mail, notifications, localization, http, avatar, fibonacci, system-info, pennant, ws, sync (each gated on its package). Demos are silently skipped when `primary !== 'react'`.

The scaffolder's `app/Views/Demos/Index.tsx` is generated from `DEMOS` via `templates/demos/index-view.ts` (filtered through `shouldScaffoldDemo`). Adding a new demo = one registry entry + one per-demo template module — Index.tsx picks it up automatically.

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
├── css/                   # index dispatcher + tailwind + plain variants
├── bootstrap/             # app, providers
├── configs/               # one file per config (app, server, log, hash, database, queue, mail, …)
├── app/                   # user-model, auth-controller, mcp-{server,tool}, service-provider
├── routes/                # api, web, console
├── pages/                 # index, error, ai-chat (per framework)
├── views/                 # welcome (per framework)
└── demos/                 # registry, index-view, shared, contact, cache, todos, queue, mail,
                            #   notifications, localization, http, avatar, fibonacci, system-info,
                            #   pennant, ws, sync, rudder-socket
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
cd create-rudder-app
pnpm build
node dist/index.js                          # launches the full interactive CLI

pnpm test                                   # 169 template tests + snapshot baseline
pnpm smoke                                  # default profile (Prisma + auth + react)
pnpm smoke --profile=minimal                # ORM=none + nothing
pnpm smoke --profile=todos                  # ORM=prisma + auth + todos demo
pnpm smoke --profile=no-db                  # ORM=none + observability + utility kitchen sink
pnpm smoke --profile=demos-all              # every demo at once
pnpm smoke --keep                           # don't delete the tmp dir on success
```

**Snapshot baseline**: `templates.snapshot.test.ts` asserts file count + total bytes + content hash + sorted paths. After a deliberate template-output change run `pnpm exec tsx scripts/recapture-snapshot.ts` and paste the new values into the test.

**Fresh-worktree gotcha**: `pnpm smoke` needs the workspace's playground Prisma client generated once before it works:

```bash
cd playground && pnpm exec prisma generate
```

Without it, the smoke's `command:list` boot step fails with `Cannot find module '.prisma/client/default'` (the smoke uses `link:` overrides into the workspace's `node_modules`, which shares a Prisma client cache).
