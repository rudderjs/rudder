# Scaffolder Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reorganize `create-rudder-app` into a cascade-aware prompt flow (ORM → Packages → Demos), bring its demo coverage to parity with the playground, standardize styling so demos work without Tailwind, and split the 4028-line `templates.ts` into modules.

**Architecture:**
1. Each prompt step **gates** the next — ORM choice disables DB-dependent packages; packages chosen unlock matching demo rows.
2. Demos move out of the package list into their own multiselect step.
3. Existing playground demos that use raw Tailwind/shadcn are refactored to semantic classes (matching `Welcome.tsx`), then ported into the scaffolder.
4. `templates.ts` is decomposed by concern (`templates/configs/`, `templates/views/`, `templates/css/`, `templates/demos/`, etc.) — pure mechanical move, no behavior change.

**Tech Stack:** TypeScript (strict, NodeNext), `@clack/prompts` for interactive prompts, `node:test` for tests, semantic CSS for styling.

**Status today (verified 2026-05-02 evening — after wave-3/4 graduation):**
- `create-rudder-app/src/templates.ts`: 4028 lines, 82 template functions
- `create-rudder-app/src/index.ts`: 291 lines, 9 steps, `demos` mixed in package multiselect
- Playground demos: **12 files** at `playground/app/Views/Demos/` — Avatar, Billing, BillingSubscriptions, Contact, Fibonacci, Index, Pennant, PennantBeta, Sync, SystemInfo, Todos, Ws
- Scaffolder ships 3 demos (Contact/Ws/Live); missing Todos/Billing/Pennant/Avatar/Fibonacci/SystemInfo
- **6 of 12 demos break without Tailwind** (verified): `Contact.tsx` (shadcn + 17 raw-Tailwind hits), `Sync.tsx` (11 hits), `Ws.tsx` (16 hits), `Pennant.tsx` (shadcn + 13), `PennantBeta.tsx` (4), `Todos.tsx` (shadcn + 7). Already semantic via `@/index.css`: Avatar, Billing, BillingSubscriptions, Fibonacci, SystemInfo, Index.

**Ship as 6 PRs, in order.** Each PR is independently reviewable and adds no regression.

---

## Phase 1 — Refactor templates.ts into modules (no behavior change)

**Why first:** every later phase touches templates.ts. Refactoring now means the rest are small, focused diffs instead of cherry-picking lines from a 4k-line file.

**Goal:** split `create-rudder-app/src/templates.ts` (4028 lines, 82 functions) into modules. Public surface stays identical — `getTemplates()`, `detectPackageManager()`, `pmExec()`, `pmRun()`, `pmInstall()` all still re-exported from `src/templates.ts`.

**Module layout:**

```
create-rudder-app/src/
├── index.ts                      # CLI entry (untouched in this phase)
├── templates.ts                  # re-exports + getTemplates() orchestrator (~150 lines)
├── templates/
│   ├── package-managers.ts       # detectPackageManager, pmExec, pmRun, pmInstall (~80 lines)
│   ├── package-json.ts           # packageJson() (~160 lines)
│   ├── tsconfig.ts               # tsconfigJson() (~40 lines)
│   ├── vite.ts                   # viteConfig() (~60 lines)
│   ├── env.ts                    # dotenv, dotenvExample, envDts, gitignore, pnpmWorkspace (~80 lines)
│   ├── server.ts                 # serverTs() (~15 lines)
│   ├── prisma/
│   │   ├── config.ts             # prismaConfig()
│   │   ├── base.ts               # prismaBase()
│   │   ├── auth.ts               # prismaAuth()
│   │   ├── notification.ts       # prismaNotification()
│   │   └── passport.ts           # prismaPassport()
│   ├── css/
│   │   ├── index.ts              # indexCss() dispatcher (~10 lines)
│   │   ├── tailwind.ts           # semanticRulesApply() (~180 lines)
│   │   └── plain.ts              # indexCssPlain() (~370 lines)
│   ├── bootstrap/
│   │   ├── app.ts                # bootstrapApp()
│   │   └── providers.ts          # bootstrapProviders()
│   ├── configs/
│   │   ├── index.ts              # configIndex()
│   │   ├── app.ts, server.ts, log.ts, hash.ts, database.ts, queue.ts, mail.ts,
│   │   ├── cache.ts, storage.ts, auth.ts, session.ts, ai.ts, sync.ts,
│   │   └── passport.ts, localization.ts, telescope.ts
│   ├── app/
│   │   ├── user-model.ts
│   │   ├── service-provider.ts
│   │   ├── auth-controller.ts
│   │   ├── mcp-echo-server.ts
│   │   └── mcp-echo-tool.ts
│   ├── routes/
│   │   ├── api.ts, web.ts, console.ts
│   ├── pages/
│   │   ├── root-config.ts
│   │   ├── index/
│   │   │   ├── config.ts, data.ts, page.ts (dispatcher)
│   │   │   ├── react.ts, vue.ts, solid.ts
│   │   ├── error/
│   │   │   ├── config.ts, page.ts, react.ts, vue.ts, solid.ts
│   │   └── ai-chat/
│   │       ├── config.ts, page.ts, react.ts, vue.ts, solid.ts
│   ├── views/
│   │   ├── welcome/
│   │   │   ├── index.ts (dispatcher), react.ts, vue.ts, solid.ts
│   └── demos/
│       ├── shared.ts             # demoPageConfig(), demoPage(), shouldScaffoldDemos()
│       ├── index-view.ts         # demosIndexView()
│       ├── contact.ts            # demosContactView()
│       ├── ws.ts                 # demosWsView() + getWsUrl()
│       └── live.ts               # demosLiveView() + getWsUrl() + bkSocketSource()
```

**Constraints:**
- No string content edits — every template's output must be byte-identical before/after.
- `getTemplates()` orchestration logic stays in `src/templates.ts`.
- Imports use `.js` extensions (NodeNext).
- Test suite (`templates.test.ts`) must pass unchanged.

### Task 1.1: Snapshot the current output

**Files:**
- Create: `create-rudder-app/src/templates.snapshot.test.ts`

**Step 1: Write a snapshot test that exercises a representative ctx**

Build a minimal context that triggers most code paths (auth + queue + mail + ai + telescope + react + vue + tailwind + shadcn + prisma + sqlite) and snapshot every generated file.

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { getTemplates } from './templates.js'
import type { TemplateContext } from './templates.js'

const ctx: TemplateContext = {
  name: 'snapshot-app',
  db: 'sqlite',
  orm: 'prisma',
  authSecret: 'a'.repeat(64),
  frameworks: ['react', 'vue'],
  primary: 'react',
  tailwind: true,
  shadcn: true,
  pm: 'pnpm',
  packages: {
    auth: true, cache: true, queue: true, storage: true, mail: true,
    notifications: true, scheduler: true, broadcast: true, sync: true,
    ai: true, mcp: true, passport: true, localization: true,
    telescope: true, boost: false, demos: true,
  },
}

test('template output is stable', () => {
  const out = getTemplates(ctx)
  // Hash-based assertion: count files + total bytes + sorted paths
  const paths = Object.keys(out).sort()
  const totalBytes = paths.reduce((sum, p) => sum + out[p]!.length, 0)
  assert.equal(paths.length, /* number from current run */ 0)
  assert.equal(totalBytes, /* total from current run */ 0)
  assert.deepEqual(paths, /* sorted list from current run */ [])
})
```

**Step 2: Run once on main to capture the baseline**

```bash
cd create-rudder-app
pnpm test 2>&1 | grep -A 2 "snapshot"   # capture failure output, fill in numbers
```

Edit the test with the captured `paths.length`, `totalBytes`, and sorted file list.

**Step 3: Run again to confirm green**

```bash
pnpm test
```

Expected: PASS. Now we have a regression net for the refactor.

**Step 4: Commit**

```bash
git add create-rudder-app/src/templates.snapshot.test.ts
git commit -m "test(create-rudder-app): snapshot getTemplates output as refactor baseline"
```

### Task 1.2: Extract package-manager helpers

**Files:**
- Create: `create-rudder-app/src/templates/package-managers.ts`
- Modify: `create-rudder-app/src/templates.ts:1-77` (remove, replace with re-exports)

**Step 1: Create the new module**

Move `PackageManager` type, `detectPackageManager`, `pmExec`, `pmRun`, `pmInstall`, `pageExt` (lines 1-78) into `templates/package-managers.ts`. Add the existing `import { execSync } from 'node:child_process'`.

**Step 2: Update re-exports in templates.ts**

```ts
// At top of templates.ts
export { detectPackageManager, pmExec, pmRun, pmInstall } from './templates/package-managers.js'
export type { PackageManager } from './templates/package-managers.js'
import { pageExt } from './templates/package-managers.js'  // internal use
```

**Step 3: Run snapshot + existing tests**

```bash
pnpm test
```

Expected: all PASS, including snapshot.

**Step 4: Commit**

```bash
git add create-rudder-app/src/templates/package-managers.ts create-rudder-app/src/templates.ts
git commit -m "refactor(create-rudder-app): extract package-manager helpers"
```

### Task 1.3: Extract CSS modules

**Files:**
- Create: `create-rudder-app/src/templates/css/index.ts`
- Create: `create-rudder-app/src/templates/css/tailwind.ts`
- Create: `create-rudder-app/src/templates/css/plain.ts`
- Modify: `create-rudder-app/src/templates.ts:697-1387` (remove, replace with import)

**Step 1: Move `indexCss` (697-836), `semanticRulesApply` (837-1012), `indexCssPlain` (1013-1387)**

Each goes into its own file under `templates/css/`. `index.ts` exports the public `indexCss(ctx)` dispatcher.

**Step 2: Update import in templates.ts**

```ts
import { indexCss } from './templates/css/index.js'
```

**Step 3: Run tests**

```bash
pnpm test
```

**Step 4: Commit**

```bash
git add create-rudder-app/src/templates/css create-rudder-app/src/templates.ts
git commit -m "refactor(create-rudder-app): extract CSS templates"
```

### Tasks 1.4 – 1.10: One commit per module group

Apply the same extract-and-re-import pattern to each remaining group, in order:

| Task | Group | Lines moved | Commit message |
|------|-------|-------------|----------------|
| 1.4 | `prisma/` (schemas) | 466-696 | `refactor(create-rudder-app): extract prisma schemas` |
| 1.5 | `configs/` (16 config files) | 1464-1922 | `refactor(create-rudder-app): extract config templates` |
| 1.6 | `bootstrap/` | 1388-1463 | `refactor(create-rudder-app): extract bootstrap templates` |
| 1.7 | `app/` (user model, providers, controllers, mcp) | 1922-2055 | `refactor(create-rudder-app): extract app/ templates` |
| 1.8 | `routes/` | 2056-2310 | `refactor(create-rudder-app): extract routes templates` |
| 1.9 | `pages/` (index, error, ai-chat per framework) | 2311-3479 | `refactor(create-rudder-app): extract pages templates` |
| 1.10 | `views/welcome/` + `demos/` | 2635-4028 | `refactor(create-rudder-app): extract views and demos` |

Each task: same Step 1-4 pattern (move → import → test → commit). Run `pnpm test` after every commit.

### Task 1.11: Final cleanup of templates.ts

**Files:**
- Modify: `create-rudder-app/src/templates.ts` (should now be ~150 lines: imports + `getTemplates()` orchestrator + re-exports)

**Step 1: Verify size and structure**

```bash
wc -l create-rudder-app/src/templates.ts
```

Expected: under 250 lines.

**Step 2: Run full test suite**

```bash
pnpm test
```

**Step 3: Run smoke**

```bash
pnpm smoke
```

Expected: project boots cleanly.

**Step 4: Commit + open PR**

```bash
git push -u origin <branch>
gh pr create --title "refactor(create-rudder-app): split 4k-line templates.ts into modules"
```

---

## Phase 2 — Cascade-aware prompt flow + package categorization

**Why:** The current 9-step flow (a) mixes Demos into the package list, (b) doesn't gate DB-dependent packages when ORM=none, (c) presents 16 packages as a flat list with no mental grouping, and (d) makes users tick foundational packages (`session`, `hash`, `cache`) that the default bootstrap requires anyway. Restructure into a cascade-aware flow with categorized package selection and silent foundation install.

**New step order:**

1. Project name (unchanged)
2. **Database ORM** (prisma / drizzle / **none**)
3. **Database driver** (only if ORM ≠ none)
4. **Packages** ← categorized multiselect (8 sections, 21 visible rows, 1 pre-checked); rows in `Auth & Users` + `Product & Features` filtered out when ORM=none
5. **Frontend frameworks**
6. **Primary framework** (only if >1)
7. **Tailwind CSS**
8. **shadcn/ui** (only if React + Tailwind)
9. **Demos** ← NEW dedicated multiselect, rows filtered by selected packages
10. **Install dependencies**

### Tier A — silent install (no checkbox)

These 3 packages are installed unconditionally. They're required by the default bootstrap or always-transitive:

| Package | Why silent |
|---|---|
| `@rudderjs/session` | Cookies, CSRF, flash. Required peer of Auth, useful standalone. |
| `@rudderjs/hash` | Password hashing. Required peer of Auth. |
| `@rudderjs/cache` | Default bootstrap registers `RateLimit.perMinute(60)` middleware which requires cache. |

Today these are partially transitive via Auth — making them explicit-but-silent prevents broken projects when Auth is unticked.

### Tier C — visible multiselect (categorized)

8 categories, 25 rows total, 1 pre-checked (Authentication). Categories are visual headers (faked via disabled clack options — see Task 2.2). All ship-ready (zero packages on 0.x as of 2026-05-02).

```
─── Auth & Users (4) ───
  [x] Authentication                   (login, register, sessions)
  [ ] Sanctum                          (API tokens — SHA-256 + abilities)
  [ ] Passport                         (OAuth2 server — requires Auth + Prisma)
  [ ] Socialite                        (social login: GitHub, Google, Facebook, Apple)

─── Infrastructure (4) ───
  [ ] Queue                            (background jobs)
  [ ] Storage                          (file uploads — local + S3)
  [ ] Scheduler                        (cron-like task scheduling)
  [ ] Image                            (resize, crop, convert — sharp wrapper)

─── Communication (4) ───
  [ ] Mail                             (SMTP + log driver)
  [ ] Notifications                    (multi-channel)
  [ ] WebSocket / Broadcast            (real-time channels)
  [ ] Sync (Yjs CRDT)                  (collaborative documents)

─── AI (3) ───
  [ ] AI                               (LLM providers — Anthropic, OpenAI, Google, Ollama)
  [ ] MCP                              (Model Context Protocol — expose tools to LLMs)
  [ ] Boost                            (AI coding DX — Claude Code/Cursor/Copilot via MCP)

─── Internationalization (1) ───
  [ ] Localization                     (i18n — trans(), setLocale())

─── Product & Features (2) ───
  [ ] Cashier-Paddle                   (subscriptions + checkout — requires Auth + Prisma)
  [ ] Pennant                          (feature flags)

─── Observability (3) ───
  [ ] Telescope                        (debug dashboard — requests, queries, jobs, exceptions)
  [ ] Pulse                            (metrics dashboard — throughput, latency, hit rates)
  [ ] Horizon                          (queue monitoring — lifecycle, workers, retry/delete)

─── Utilities (4) ───
  [ ] Crypt                            (AES-256-CBC + HMAC encryption)
  [ ] HTTP                             (fluent fetch client — retries, timeouts, pools)
  [ ] Process                          (shell execution — run, pool, pipe, real-time output)
  [ ] Concurrency                      (parallel execution — worker thread pool)
```

### ORM=none gating

When `orm === false`, the following rows are **filtered out** of the multiselect (not just disabled — clack doesn't support per-row disable):

- `Auth & Users`: Authentication, Sanctum, Passport (Socialite stays — uses external OAuth)
- `Product & Features`: Cashier-Paddle (Pennant stays — has memory driver)

A note appears above the prompt: `Database not selected — auth, passport, billing options hidden.`

### Task 2.1: Tier A silent install + drop session/hash/cache from selection

**Files:**
- Modify: `create-rudder-app/src/templates/package-json.ts` (always include `session`, `hash`, `cache` deps)
- Modify: `create-rudder-app/src/templates/bootstrap/providers.ts` (always include their providers)
- Modify: `create-rudder-app/src/index.ts` (remove `cache` from package multiselect; `session` and `hash` were never in the multiselect)
- Modify: `create-rudder-app/src/templates.ts` (drop `cache` field from `TemplateContext.packages` since it's no longer optional)

**Step 1: Failing test**

```ts
test('session, hash, cache always present regardless of selection', () => {
  const out = getTemplates({ ...baseCtx, packages: { ...allPackagesFalse } })
  assert.match(out['package.json']!, /@rudderjs\/session/)
  assert.match(out['package.json']!, /@rudderjs\/hash/)
  assert.match(out['package.json']!, /@rudderjs\/cache/)
})
```

**Step 2: Run (FAIL)** — currently `hash`/`session` only ship if `auth` is true; `cache` is opt-in.

**Step 3: Implement** — unconditionally add the three deps; ensure providers boot (cache → memory driver default; session → cookie default).

**Step 4: Run (PASS) + smoke**

**Step 5: Recapture snapshot baseline** (file count + bytes shift slightly because cache was conditional)

**Step 6: Commit**

```bash
git commit -m "feat(create-rudder-app): always install session/hash/cache (Tier A)"
```

### Task 2.2: Categorized multiselect with section headers

**Files:**
- Modify: `create-rudder-app/src/index.ts` (rebuild package multiselect with category separators)

**Step 1: Build the option array with separator rows**

```ts
const PACKAGES = [
  { __sep: 'Auth & Users' },
  { value: 'auth',          label: 'Authentication',   hint: 'login, register, sessions' },
  { value: 'sanctum',       label: 'Sanctum',          hint: 'API tokens (SHA-256 + abilities)' },
  { value: 'passport',      label: 'Passport',         hint: 'OAuth2 server — requires Auth + Prisma' },
  { value: 'socialite',     label: 'Socialite',        hint: 'social login: GitHub, Google, Facebook, Apple' },

  { __sep: 'Infrastructure' },
  { value: 'queue',         label: 'Queue',            hint: 'background jobs' },
  { value: 'storage',       label: 'Storage',          hint: 'file uploads (local + S3)' },
  { value: 'scheduler',     label: 'Scheduler',        hint: 'cron-like task scheduling' },
  { value: 'image',         label: 'Image',            hint: 'resize, crop, convert (sharp wrapper)' },

  { __sep: 'Communication' },
  { value: 'mail',          label: 'Mail',             hint: 'SMTP + log driver' },
  { value: 'notifications', label: 'Notifications',    hint: 'multi-channel' },
  { value: 'broadcast',     label: 'WebSocket / Broadcast', hint: 'real-time channels' },
  { value: 'sync',          label: 'Sync (Yjs CRDT)',  hint: 'collaborative documents' },

  { __sep: 'AI' },
  { value: 'ai',            label: 'AI',               hint: 'LLM providers' },
  { value: 'mcp',           label: 'MCP',              hint: 'Model Context Protocol' },
  { value: 'boost',         label: 'Boost',            hint: 'AI coding DX (Claude Code/Cursor/Copilot)' },

  { __sep: 'Internationalization' },
  { value: 'localization',  label: 'Localization',     hint: 'i18n — trans(), setLocale()' },

  { __sep: 'Product & Features' },
  { value: 'cashierPaddle', label: 'Cashier-Paddle',   hint: 'billing — requires Auth + Prisma' },
  { value: 'pennant',       label: 'Pennant',          hint: 'feature flags' },

  { __sep: 'Observability' },
  { value: 'telescope',     label: 'Telescope',        hint: 'debug dashboard' },
  { value: 'pulse',         label: 'Pulse',            hint: 'metrics dashboard' },
  { value: 'horizon',       label: 'Horizon',          hint: 'queue monitoring' },

  { __sep: 'Utilities' },
  { value: 'crypt',         label: 'Crypt',            hint: 'AES encryption + HMAC' },
  { value: 'http',          label: 'HTTP',             hint: 'fluent fetch client — retries, timeouts, pools' },
  { value: 'process',       label: 'Process',          hint: 'shell execution — run, pool, pipe' },
  { value: 'concurrency',   label: 'Concurrency',      hint: 'parallel execution via worker threads' },
] as const
```

**Step 2: Render separators as disabled rows**

```ts
const DB_GATED = new Set(['auth', 'sanctum', 'passport', 'cashierPaddle'])
const options = PACKAGES.flatMap(p => {
  if ('__sep' in p) {
    return [{ value: `__sep_${p.__sep}`, label: `── ${p.__sep} ──`, disabled: true, hint: '' }]
  }
  if (orm === false && DB_GATED.has(p.value)) return []
  return [{ value: p.value, label: p.label, hint: p.hint }]
})

if (orm === false) {
  console.log('  Database not selected — auth, passport, billing options hidden.\n')
}

const packageAnswer = await multiselect({
  message: 'Select packages',
  options,
  initialValues: ['auth'],
  required: false,
})

const selected = (packageAnswer as string[]).filter(v => !v.startsWith('__sep_'))
```

Note: clack 1.0's `multiselect` may not honor `disabled` exactly — verify behavior; if it allows ticking, filter selectors out of the result anyway.

**Step 3: Update TemplateContext.packages**

Drop `cache: boolean`, `demos: boolean`. Add `sanctum`, `socialite`, `pulse`, `horizon`, `crypt`, `cashierPaddle` (camelCase). The `demos` field is replaced by `demos: string[]` in Task 2.4.

**Step 4: Manual end-to-end**

```bash
pnpm build
cd /tmp && rm -rf cat-test && node /Users/sleman/Projects/rudder/create-rudder-app/dist/index.js cat-test
# Verify: 8 visual sections, Authentication pre-checked, separators not selectable
# Try ORM=none — verify Auth/Sanctum/Passport/Cashier-Paddle disappear
```

**Step 5: Commit**

```bash
git commit -m "feat(create-rudder-app): categorized package multiselect with section headers"
```

### Task 2.3: Wire each new package's deps + config

**Files:**
- Modify: `create-rudder-app/src/templates/package-json.ts` (add deps for sanctum, socialite, pulse, horizon, crypt, cashier-paddle, pennant)
- Create: `create-rudder-app/src/templates/configs/sanctum.ts`
- Create: `create-rudder-app/src/templates/configs/socialite.ts`
- Create: `create-rudder-app/src/templates/configs/pulse.ts`
- Create: `create-rudder-app/src/templates/configs/horizon.ts`
- Create: `create-rudder-app/src/templates/configs/crypt.ts`
- Create: `create-rudder-app/src/templates/configs/cashier.ts`
- Create: `create-rudder-app/src/templates/configs/pennant.ts`
- Modify: `create-rudder-app/src/templates/configs/index.ts` (wire conditional imports)
- Modify: `create-rudder-app/src/templates/env.ts` (add env keys: PADDLE_VENDOR_ID, GITHUB_CLIENT_ID, etc.)

**Step 1: Failing test** — one assertion per package

```ts
for (const pkg of ['sanctum', 'socialite', 'pulse', 'horizon', 'crypt', 'cashier-paddle', 'pennant']) {
  test(`${pkg} adds dep and config when selected`, () => {
    const ctx = { ...baseCtx, packages: { ...basePackages, [camelCase(pkg)]: true } }
    const out = getTemplates(ctx)
    assert.match(out['package.json']!, new RegExp(`@rudderjs/${pkg}`))
  })
}
```

**Step 2: Run (FAIL)**

**Step 3: Implement deps + minimal config files** — config files mirror playground patterns where they exist; for new packages, follow each package's README quick-start.

**Step 4: Run (PASS) + smoke each combination**

```bash
pnpm test
pnpm smoke   # runs the non-TTY scaffolder smoke
```

**Step 5: Commit**

```bash
git commit -m "feat(create-rudder-app): wire sanctum/socialite/pulse/horizon/crypt/cashier/pennant deps + config"
```

### Task 2.4: Extract Demos from package multiselect into its own step

**Files:**
- Modify: `create-rudder-app/src/index.ts` (remove `demos` from package multiselect, add new step after styling)

**Step 1: Define the demo registry**

Create `create-rudder-app/src/templates/demos/registry.ts`:

```ts
export interface DemoSpec {
  value:    string
  label:    string
  hint?:    string
  requires?: ReadonlyArray<keyof TemplateContext['packages']>
  requiresOrm?: boolean
}

export const DEMOS: DemoSpec[] = [
  { value: 'contact',  label: 'Contact form',     hint: 'CSRF + Zod validation' },
  { value: 'todos',    label: 'Todos CRUD',       hint: 'requires ORM', requiresOrm: true },
  { value: 'ws',       label: 'WebSocket chat',   hint: 'requires Broadcast', requires: ['broadcast'] },
  { value: 'live',     label: 'Yjs collaboration', hint: 'requires Sync',     requires: ['sync'] },
  { value: 'billing',  label: 'Billing checkout', hint: 'requires Cashier-Paddle', requires: ['cashierPaddle'] },
  { value: 'pennant',  label: 'Feature flags',    hint: 'requires Pennant',  requires: ['pennant'] },
]
```

**Step 2: Add the prompt**

After the shadcn step, before install confirm:

```ts
const availableDemos = DEMOS.filter(d => {
  if (d.requiresOrm && orm === false) return false
  if (d.requires) return d.requires.every(p => packages[p])
  return true
})

let demos: string[] = []
if (availableDemos.length > 0) {
  const demoAnswer = await multiselect({
    message: 'Select demos to scaffold',
    options: availableDemos,
    initialValues: ['contact'],
    required: false,
  })
  if (isCancel(demoAnswer)) { cancel('Cancelled.'); process.exit(0) }
  demos = demoAnswer as string[]
}
```

**Step 3: Replace `packages.demos: boolean` with `demos: string[]` on TemplateContext**

Touch:
- `create-rudder-app/src/templates.ts` (`TemplateContext` type — add `demos: string[]`)
- `create-rudder-app/src/templates/demos/shared.ts` (`shouldScaffoldDemos` becomes `shouldScaffoldDemo(ctx, name)`)
- All `getTemplates()` switches that branched on `packages.demos`

**Step 4: Update `templates.test.ts` and snapshot test**

Recapture the snapshot baseline since `demos: true` is replaced by `demos: ['contact', 'ws', 'live']`.

**Step 5: Manual end-to-end run**

```bash
pnpm build
cd /tmp && rm -rf demo-test && node /Users/sleman/Projects/rudder/create-rudder-app/dist/index.js demo-test
# Pick: prisma + sqlite + auth + broadcast + sync + react + tailwind + shadcn
# Verify Demos step appears with: contact, todos, ws, live (4 rows since cashier/pennant not selected)
```

**Step 6: Commit**

```bash
git commit -m "feat(create-rudder-app): extract demos into dedicated cascade-aware step"
```

### Task 2.5: Open the Phase 2 PR

```bash
git push -u origin <branch>
gh pr create --title "feat(create-rudder-app): cascade-aware prompt flow + categorized packages"
```

PR body lists:
- Tier A silent install (session, hash, cache always present)
- 8 categorized package sections, 25 visible rows, 1 pre-checked (Authentication)
- 11 new packages added: sanctum, socialite, pulse, horizon, crypt, cashier-paddle, pennant, image, http, process, concurrency
- ORM=none filters out auth, sanctum, passport, cashier-paddle
- Demos extracted into dedicated multiselect step, gated by package selection

---

## Phase 3 — Standardize playground demo styling

**Why:** 6 of the 12 playground demos use shadcn imports or raw Tailwind utilities and break in projects that opt out of Tailwind. Refactor to use the same semantic-class pattern as `Welcome.tsx` and the recent `Avatar.tsx` / `Fibonacci.tsx` / `SystemInfo.tsx` demos.

**Files needing refactor** (verified 2026-05-02 evening):

| File | shadcn imports | raw-Tailwind hits | Currently shipped by scaffolder? |
|---|---|---|---|
| Contact.tsx | ✓ | 17 | ✓ (`contact`) |
| Sync.tsx | — | 11 | ✓ (`live`) |
| Ws.tsx | — | 16 | ✓ (`ws`) |
| Pennant.tsx | ✓ | 13 | — |
| PennantBeta.tsx | — | 4 | — |
| Todos.tsx | ✓ | 7 | — |

**Critical:** Contact/Sync/Ws are the 3 demos the scaffolder currently ships, so generated projects today break without Tailwind. Phase 3's first task is to fix the playground versions, then Phase 4 ports the fixed versions into the scaffolder.

### Task 3.1: Inventory existing semantic classes

**Files:**
- Read: `playground/app/index.css` (or the equivalent CSS entry — may be `playground/src/index.css`)
- Read: `playground/app/Views/Welcome.tsx`
- Read: `playground/app/Views/Demos/Avatar.tsx`, `Fibonacci.tsx`, `SystemInfo.tsx` (already semantic — reference)

**Step 1: List the semantic classes already defined**

```bash
grep -E "^\.[a-z-]+ ?\{" playground/app/index.css | sort -u
```

Document the existing class vocabulary (e.g. `.page`, `.hero-title`, `.feature-card`, `.form-card`, `.form-input`, `.form-button`, `.button-group`).

**Step 2: Identify gaps for Billing/Pennant/Todos**

Map shadcn primitives used → semantic classes needed:
- `<Card>` → `.demo-card`
- `<Input>` → `.form-input` (already exists)
- `<Button>` → `.form-button` or `.button-primary`
- `<Checkbox>` → `.form-checkbox`
- `<Badge>` → `.badge`

List net-new classes to add to `index.css` (both Tailwind and plain variants).

**Step 3: Commit the inventory note inside the plan or as a comment**

No code change — this is a research task. Capture findings as a section at the bottom of this plan doc.

### Task 3.2: Refactor `Todos.tsx` to semantic classes

**Files:**
- Modify: `playground/app/Views/Demos/Todos.tsx` (remove shadcn imports + raw Tailwind)
- Modify: `playground/app/index.css` (add any missing semantic classes — both Tailwind `@apply` and plain CSS variants)

**Step 1: Replace shadcn components with native HTML + semantic classes**

```tsx
// before
<Button onClick={addTodo}>{loading ? '...' : 'Add'}</Button>
// after
<button className="form-button" onClick={addTodo}>{loading ? '...' : 'Add'}</button>
```

Same for `<Input>`, `<Checkbox>`, `<Card>`. Drop imports.

**Step 2: Run playground**

```bash
cd playground && pnpm dev
# visit /demos/todos — verify visual + functional parity
```

**Step 3: Verify works without Tailwind**

Temporarily remove `@import "tailwindcss"` from `index.css`, restart, verify the page is still usable (may look different but should not be broken). Restore.

**Step 4: Commit**

```bash
git commit -m "refactor(playground): Todos demo uses semantic classes"
```

### Tasks 3.3 – 3.5: Repeat for Contact, Sync, Ws, Pennant, PennantBeta

| Task | File(s) | Commit |
|------|---------|--------|
| 3.3 | `playground/app/Views/Demos/Contact.tsx` | `refactor(playground): Contact demo uses semantic classes (drops shadcn)` |
| 3.4 | `playground/app/Views/Demos/Sync.tsx` + `Ws.tsx` | `refactor(playground): Sync + Ws demos use semantic classes` |
| 3.5 | `playground/app/Views/Demos/Pennant.tsx` + `PennantBeta.tsx` | `refactor(playground): Pennant demos use semantic classes (drops shadcn)` |

Each: replace shadcn imports + raw Tailwind → native HTML + semantic classes; verify in browser; verify no-Tailwind path; commit.

**Note:** `Index.tsx` already uses semantic classes (0 raw-Tailwind hits) — no audit task needed. `Billing.tsx`, `BillingSubscriptions.tsx`, `Avatar.tsx`, `Fibonacci.tsx`, `SystemInfo.tsx` also already semantic — no work.

### Task 3.6: Open the Phase 3 PR

```bash
gh pr create --title "refactor(playground): demos use semantic classes (no shadcn dependency)"
```

---

## Phase 4 — Port playground demos into the scaffolder

**Why:** Now that the playground demos are styled portably and the scaffolder has cascade slots, port every demo that's tied to a Phase-2 package. Each demo needs: view file + routes + (optionally) model + service + migration + config. Avatar/Fibonacci/SystemInfo are eligible because Phase 2 adds image/process/concurrency to the multiselect.

### Task 4.1: Port Todos demo

**Files:**
- Create: `create-rudder-app/src/templates/demos/todos.ts`
- Modify: `create-rudder-app/src/templates.ts` (wire into `getTemplates()` when `demos.includes('todos')`)
- Modify: `create-rudder-app/src/templates/routes/web.ts` (add `/demos/todos` route)
- Modify: `create-rudder-app/src/templates/routes/api.ts` (add CRUD endpoints)
- Modify: `create-rudder-app/src/templates/prisma/` (new `todo.ts` schema partial OR add to `base.ts`)

**Step 1: Failing test**

```ts
test('todos demo scaffolds view + routes + prisma model', () => {
  const out = getTemplates({ ...baseCtx, orm: 'prisma', packages: { ...basePackages }, demos: ['todos'] })
  assert.ok(out['app/Views/Demos/Todos.tsx'])
  assert.match(out['routes/web.ts']!, /\/demos\/todos/)
  assert.match(out['routes/api.ts']!, /\/api\/todos/)
  assert.match(out['prisma/schema/app.prisma']!, /model Todo/)
})
```

**Step 2: Implement**

Port the playground's `Todos.tsx` (post-Phase-3 semantic version). Generate `app/Modules/Todo/TodoSchema.ts`, `TodoService.ts`, `TodoServiceProvider.ts` — adapted from playground. Add Prisma schema. Wire routes.

**Step 3: Manual end-to-end**

```bash
pnpm build
cd /tmp && rm -rf todo-app && node /Users/sleman/Projects/rudder/create-rudder-app/dist/index.js todo-app
# Pick: prisma + sqlite + auth + react + select Todos demo
cd todo-app && pnpm exec prisma db push && pnpm dev
# visit /demos/todos — verify add/toggle/delete work
```

**Step 4: Commit**

```bash
git commit -m "feat(create-rudder-app): scaffold Todos CRUD demo when ORM selected"
```

### Task 4.2: Port Billing demo (gated on cashier-paddle + auth + orm)

Same pattern as 4.1. Port `playground/app/Views/Demos/Billing.tsx` + `BillingSubscriptions.tsx` + the underlying webhook controller + Cashier-Paddle config + Prisma migrations for subscriptions.

**Step 4: Commit**

```bash
git commit -m "feat(create-rudder-app): scaffold Billing demo when Cashier-Paddle selected"
```

### Task 4.3: Port Pennant demo (gated on pennant)

Port `Pennant.tsx` + `PennantBeta.tsx`. Add `Pennant.feature(...)` definitions in `app/Providers/AppServiceProvider.ts`. Add `/demos/pennant` route.

**Step 4: Commit**

```bash
git commit -m "feat(create-rudder-app): scaffold Pennant feature-flag demo when selected"
```

### Task 4.4: Port Avatar demo (gated on storage + image)

Same pattern as 4.1. Port `playground/app/Views/Demos/Avatar.tsx` — file upload + image resize. Add `/demos/avatar` web route + `/api/avatar` upload endpoint. Already semantic — no styling work.

**Step 4: Commit**

```bash
git commit -m "feat(create-rudder-app): scaffold Avatar upload demo when Storage + Image selected"
```

### Task 4.5: Port Fibonacci demo (gated on concurrency)

Port `playground/app/Views/Demos/Fibonacci.tsx` — parallel computation via worker threads. Add `/demos/fibonacci` route + the API endpoint that calls `Concurrency.run(...)`. Already semantic.

**Step 4: Commit**

```bash
git commit -m "feat(create-rudder-app): scaffold Fibonacci concurrency demo when selected"
```

### Task 4.6: Port SystemInfo demo (gated on process)

Port `playground/app/Views/Demos/SystemInfo.tsx` — runs shell commands (uname/uptime/etc) via `Process.run()`. Add `/demos/system-info` route + API endpoint. Already semantic.

**Step 4: Commit**

```bash
git commit -m "feat(create-rudder-app): scaffold SystemInfo process demo when selected"
```

### Task 4.7: Open the Phase 4 PR

```bash
gh pr create --title "feat(create-rudder-app): port 6 playground demos (Todos/Billing/Pennant/Avatar/Fibonacci/SystemInfo)"
```

---

## Phase 5 — Net-new small demos

**Why:** With the cascade in place, adding a small demo per visible package is cheap and dramatically improves discoverability. Each demo is a single small view + maybe one API route. Skip packages without UI (scheduler, mcp, passport, telescope, boost).

**Per-demo specs** — each has its own task in this phase. Pattern: small view, semantic classes, one API endpoint where applicable, registered in the `DEMOS` registry, gated on the relevant package.

| Task | Demo | Package gate | What it shows |
|------|------|--------------|---------------|
| 5.1 | Cache counter | `cache` | "Page viewed N times" — counter persisted via `Cache.increment()` |
| 5.2 | Job dispatch | `queue` | Button → dispatches `ExampleJob` → "queued, see Telescope" hint |
| 5.3 | Mail send | `mail` | "Send test email" → log driver writes to terminal |
| 5.4 | Notifications trigger | `notifications` | Trigger a notification, show across mail+log channels |
| 5.5 | Localization | `localization` | Language switcher → re-renders strings via `trans()` |
| 5.6 | HTTP client | `http` | "Fetch from external API" using `Http.get()` with retry + timeout |

(Storage upload covered by Avatar port in Phase 4.4. Concurrency + Process covered by Fibonacci/SystemInfo ports in 4.5/4.6.)

### Task 5.X (template for each)

**Files:**
- Create: `create-rudder-app/src/templates/demos/<name>.ts`
- Modify: `create-rudder-app/src/templates/demos/registry.ts` (add to `DEMOS`)
- Modify: `create-rudder-app/src/templates.ts` (wire into `getTemplates()`)
- Modify: `create-rudder-app/src/templates/routes/{web,api}.ts`

**Step 1: Failing test** (as in 4.1)
**Step 2: Implement** (small view + routes)
**Step 3: Manual verify** (scaffold a fresh app with that package + demo, click through)
**Step 4: Commit**

### Task 5.7: Open the Phase 5 PR

```bash
gh pr create --title "feat(create-rudder-app): per-package demos (cache, queue, mail, notifications, localization, http)"
```

---

## Phase 6 — ORM=none survivability

**Why:** Phase 2 hides DB-dependent packages from the multiselect when ORM=none, but a few framework defaults still assume a DB exists (Telescope's SQLite storage, Pulse's SQLite storage). Tighten the no-DB path so a user picking "None" gets a project that boots cleanly.

### Task 6.1: Telescope/Pulse storage fallback when no DB

**Files:**
- Modify: `create-rudder-app/src/templates/configs/telescope.ts` (use memory storage when ORM=none)
- Modify: `create-rudder-app/src/templates/configs/pulse.ts` (same — if Pulse demo lands)

**Step 1: Test**

```ts
test('telescope falls back to memory storage when no ORM', () => {
  const out = getTemplates({ ...baseCtx, orm: false, packages: { ...basePackages, telescope: true } })
  assert.match(out['config/telescope.ts']!, /storage:\s*'memory'/)
})
```

**Step 2: Implement** — branch on `ctx.orm === false` in the config template

**Step 3: Manual smoke**

```bash
pnpm build
cd /tmp && rm -rf nodb && node .../create-rudder-app/dist/index.js nodb
# pick: ORM none, telescope, react, no tailwind
cd nodb && pnpm dev
# verify boots, telescope dashboard renders
```

**Step 4: Commit**

```bash
git commit -m "feat(create-rudder-app): telescope/pulse use memory storage when ORM=none"
```

### Task 6.2: Smoke-test matrix in CI

**Files:**
- Modify: `create-rudder-app/scripts/smoke.ts` (add no-DB scenario)

Run scaffolder twice in smoke: once with full options, once with `orm: false` + minimal packages. Both must boot cleanly.

**Step 4: Commit**

```bash
git commit -m "test(create-rudder-app): smoke covers no-DB path"
```

### Task 6.3: Open the Phase 6 PR

```bash
gh pr create --title "feat(create-rudder-app): ORM=none survivability (storage fallbacks + smoke)"
```

---

## Cross-phase invariants

- **Snapshot test must remain green after every commit** in Phase 1. After Phase 2 the snapshot is recaptured once.
- **Smoke test (`pnpm smoke`) must pass at the end of every phase.**
- **No commits without `pnpm test && pnpm typecheck`.**
- **PRs go through Changesets** — each PR adds an appropriate changeset (`pnpm changeset`).

## Out of scope (defer)

- Vue/Solid demo views — React only for now (per memory `feedback_react_only_default_for_packages`)
- Horizon/Pulse/Telescope as demos — they're dashboards, not features; the demos surface end-user behavior
- Sanctum/Socialite demos — packages added in Phase 2, demo pages can come later
- Demo gallery in playground that reads `DEMOS` registry — speculative, defer until needed
