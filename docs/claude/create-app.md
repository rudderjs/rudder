# create-rudder-app

> This file is read on-demand by Claude Code when working on the scaffolder.
> For the always-loaded essentials, see `/CLAUDE.md`.

---

## Prompts (in order)
1. Project name
2. Database ORM — Prisma · Drizzle · None
3. Database driver — SQLite · PostgreSQL · MySQL (if ORM selected)
4. Select packages — **multiselect**: auth, cache, queue, storage, mail, notifications, scheduler, broadcast, live, **ai**, localization (defaults: auth + cache)
5. Include Todo module? — yes/no (only if ORM selected)
6. Frontend frameworks — **multiselect**: React · Vue · Solid (default: React)
7. Primary framework — single select, only shown when >1 framework selected
8. Add Tailwind CSS? — yes/no (default: yes)
9. Add shadcn/ui? — yes/no (default: yes), **only shown when React + Tailwind are both selected**
10. Install dependencies? — yes/no

When `auth` is selected, `@rudderjs/hash` and `@rudderjs/session` are automatically included (not prompted). `@rudderjs/log` is always included. When `ai` is selected, generates `config/ai.ts`, `ai()` provider, AI chat demo page at `/ai-chat`, and `POST /api/ai/chat` route.

---

## Package Manager Support

PM is auto-detected from `npm_config_user_agent` (set by pnpm/npm/yarn/bun when invoking the installer).

| | pnpm | npm | yarn | bun |
|---|---|---|---|---|
| `pnpm-workspace.yaml` | generated | no | no | no |
| native-build field | `pnpm.onlyBuiltDependencies` | *(none needed)* | *(none needed)* | `trustedDependencies` |
| exec | `pnpm exec <bin>` | `npx <bin>` | `yarn dlx <bin>` | `bunx <bin>` |
| run | `pnpm <script>` | `npm run <script>` | `yarn <script>` | `bun <script>` |

Helpers: `detectPackageManager()`, `pmExec(pm, bin)`, `pmRun(pm, script)`, `pmInstall(pm)` — all exported from `templates.ts`.

---

## Template Gotchas
- `tsconfig.json` must be self-contained — no `extends: ../tsconfig.base.json` (monorepo-only)
- All `@rudderjs/*` deps use `'latest'` — pnpm double-zero semver (`^0.0.x`) pins to exact version
- Native-build field in `package.json` is PM-specific (see table above)
- Use `database(configs.database)` from `@rudderjs/orm-prisma` not `DatabaseServiceProvider` in providers.ts
- `shadcn` dep only added when React + Tailwind are both selected
- `src/index.css` is always generated; contents differ by `ctx.tailwind` — Tailwind variant uses `@import "tailwindcss"` + `@apply` rules from `semanticRulesApply()`, plain variant uses hand-authored CSS from `indexCssPlain()`. Same semantic class selectors in both (`.page`, `.feature-card`, `.auth-card`, `.todo-list`, `.chat-bubble`, …) so JSX never branches on the flag
- React + Solid together: Vite plugins use `include`/`exclude` to disambiguate `.tsx` files
- Secondary frameworks get demo pages at `pages/{fw}-demo/` (each with its own `+config.ts`)
- `@rudderjs/session` is in deps (providers.ts imports it)
- `@rudderjs/log` is always a base dep — `config/log.ts` + `log()` provider always generated
- `@rudderjs/hash` is auto-included with auth — `config/hash.ts` + `hash()` provider wired when auth selected

---

## Vike +server.ts Strategy
- **All apps**: `+server.ts` is generated at the **project root**, wiring `bootstrap/app.ts` to Vike via `@vikejs/hono`. The file exports `{ fetch: app.fetch }` satisfying Vike's `Server` type.
- **Single framework**: renderer (`vike-react`/`vike-vue`/`vike-solid`) included in root `pages/+config.ts`. No `pages/index/+config.ts` generated.
- **Multi-framework**: root `pages/+config.ts` has no renderer. Each page/folder has its own `+config.ts` extending the correct renderer. `pages/index/+config.ts` is generated for the primary framework.
- **Config style**: All `+config.ts` files use `satisfies Config` (not `as unknown as Config`).
- **No vike-photon**: The old `vike-photon` package is no longer used. `@vikejs/hono` replaces it.

---

## Provider Ordering

Providers follow the playground pattern — infrastructure boots first, features second, app last:

```
log → database → session → hash → cache → auth → events → queue → mail → storage → localization → scheduler → notifications → broadcast → live → ai → AppServiceProvider → TodoServiceProvider
```

---

## Local Testing
```bash
cd create-rudder-app
pnpm build
node dist/index.js        # launches the full interactive CLI
```
