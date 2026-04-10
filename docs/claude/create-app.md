# create-rudderjs-app

> This file is read on-demand by Claude Code when working on the scaffolder.
> For the always-loaded essentials, see `/CLAUDE.md`.

---

## Prompts (in order)
1. Project name
2. Database ORM — Prisma · Drizzle · None
3. Database driver — SQLite · PostgreSQL · MySQL (if ORM selected)
4. Select packages — **multiselect**: auth, cache, queue, storage, mail, notifications, scheduler, broadcast, live, **ai**, panels (defaults: auth + cache)
5. Add media library plugin? — yes/no (only shown when panels + storage selected)
6. Add AI workspaces plugin? — yes/no (only shown when panels + ai selected)
7. Include Todo module? — yes/no (only if ORM selected)
8. Frontend frameworks — **multiselect**: React · Vue · Solid (default: React)
9. Primary framework — single select, only shown when >1 framework selected
10. Add Tailwind CSS? — yes/no (default: yes)
11. Add shadcn/ui? — yes/no (default: yes), **only shown when React + Tailwind are both selected**
12. Install dependencies? — yes/no

When `panels` is selected, scaffolds `app/Panels/AdminPanel.ts` with `Panel.make()`, wires `panels()` provider, and generates `UserResource` (if auth+orm) and `TodoResource` (if todo). Media and workspaces are wired via `Panel.use()`. When `ai` is selected, generates `config/ai.ts`, `ai()` provider, AI chat demo page at `/ai-chat`, and `POST /api/ai/chat` route.

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
- `src/index.css` not generated at all when Tailwind is not selected
- React + Solid together: Vite plugins use `include`/`exclude` to disambiguate `.tsx` files
- Secondary frameworks get demo pages at `pages/{fw}-demo/` (each with its own `+config.ts`)
- `@rudderjs/session` is in deps (providers.ts imports it)

---

## Vike +config.ts Strategy
- **All apps**: `+server.ts` is generated at the project root, wiring `bootstrap/app.ts` to Vike via `@vikejs/hono`.
- **Single framework**: renderer (`vike-react`/`vike-vue`/`vike-solid`) included in root `pages/+config.ts`. No `pages/index/+config.ts` generated.
- **Multi-framework**: root `pages/+config.ts` has no renderer. Each page/folder has its own `+config.ts` extending the correct renderer. `pages/index/+config.ts` is generated for the primary framework.

---

## Local Testing
```bash
cd create-rudderjs-app
pnpm build
node dist/index.js        # launches the full interactive CLI
```
