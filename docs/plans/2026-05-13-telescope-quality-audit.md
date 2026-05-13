# Telescope code-quality cleanup — file split + test coverage

> **Status:** drafting 2026-05-13
> **Date:** 2026-05-13
> **Scope:** internal cleanup of `@rudderjs/telescope` following the framework #418–#421 pattern. No public API breaks expected.
>
> **Why telescope is different from prior arcs:**
> - Cast surface is tiny (12 across 4557 LOC; mostly load-bearing peer-package bridges) — not the headline win
> - File split is real (`views/vanilla/details/views.ts` is 703 LOC, the biggest non-test file in the package)
> - Test coverage is the *biggest* opportunity: 1 test file, 13 of 19 collectors have zero coverage, `SqliteStorage` is untested, no view-rendering tests
>
> So the PR mix is heavier on **PR C (tests)** than the framework arc was. PR B (split) is still the structural win.

---

## TL;DR

| Framework analog | Telescope PR | Theme |
|---|---|---|
| #418 (docs + latent bugs) | **PR A** — docs + latent fixes + targeted cast tightening | hidden contracts to JSDoc; clean up `.map().join('')` SafeString pattern; extract `attachBatchId(req)` raw-bag helper (sanctum-style) |
| #419 (router split) | **PR B** — split `views/vanilla/details/views.ts` | 703 LOC → barrel + 3 siblings (format, request-views, ai-views) |
| #421 (cast + test gap fill) | **PR C** — test coverage for 13 untested collectors + `SqliteStorage` + list-slug parity | Use playground `/test/*` routes as canonical fixtures (per CLAUDE.md) |

**Expected deltas:**
- `views/vanilla/details/views.ts`: 703 → ~250 LOC (−65%)
- New siblings: `details/format.ts` (~50), `details/request-views.ts` (~250), `details/ai-views.ts` (~150)
- New test files: 13–14 (`collectors/<name>.test.ts` per gap + `storage.sqlite.test.ts` + `routes.slug.test.ts`)
- Casts (`as unknown as`): 12 → ~8 (3 raw-bag wins in request.ts via `attachBatchId` helper; storage SqliteStorage cast tightened; rest of peer-bridge casts left alone — load-bearing)

Each PR ships independently. A is independent of all others. B touches one file. C depends on nothing.

Run after each PR's last commit:
```bash
pnpm --filter @rudderjs/telescope typecheck
pnpm --filter @rudderjs/telescope test
```

---

## Pre-flight (run once before starting)

```bash
git checkout main && git pull --ff-only
pnpm install
pnpm build
pnpm --filter @rudderjs/telescope typecheck    # expect clean
pnpm --filter @rudderjs/telescope test         # expect green (10 describe blocks pass)
```

Baseline must be green.

---

## PR A — Docs + latent fixes + targeted cast tightening

Smallest-diff PR. All items are local to telescope. Bundle them because each is small and they all read the same way to a reviewer ("hidden contracts + small cleanups").

**Branch:** `docs/telescope-quality-fixes`

### A1 — JSDoc the `TelescopeRegistry.recording` globalThis pattern

**File:** `packages/telescope/src/index.ts:51-65`

The `globalThis['__rudderjs_telescope_recording__']` slot survives Vite SSR module re-evaluation (CLAUDE.md pitfall). Future maintainers reading the class won't know that, and "just use a static field" looks correct until someone toggles recording in dev and watches it reset on every HMR.

**Edits:**
- Add JSDoc to `TelescopeRegistry.recording` getter/setter covering: why globalThis (SSR module re-eval), default `true`, that `storage.store()` checks this centrally.

### A2 — JSDoc list-slug parity contract on EntryList + routes

**Files:** `packages/telescope/src/views/vanilla/EntryList.ts:51-58`, `packages/telescope/src/routes.ts:124-130`

The slug logic (`'query' → 'queries'`, `'view' → 'views'`, `'http'/'ai'/'mcp'` stay singular, rest get `s`) is duplicated as literal code in two files with an inline `// Must match …` comment. A drift makes the table render empty with a silent 404.

**Edits:**
- Add JSDoc on both `apiPath` declarations: cross-reference the other file by path, explain the silent-404 failure mode, point at the PR C parity test.
- Consider extracting `toApiSlug(type: EntryType): string` to `types.ts` and using it from both sites. Decide during PR A — if it saves more than 4 lines and doesn't pull `types.ts` into the client bundle, do it. Otherwise leave the parity test in PR C as the safeguard.

### A3 — JSDoc the exception-collector swallow

**File:** `packages/telescope/src/collectors/exception.ts`

CLAUDE.md flags this as a load-bearing pattern: the exception collector wraps `record()` in try/catch so a collector failure doesn't cascade into a stack overflow via the error reporter. Source has a comment; promote to JSDoc on the class so it survives refactors.

### A4 — JSDoc `SqliteStorage` peer-resolution + WAL mode

**File:** `packages/telescope/src/storage.ts:102+`

Two hidden contracts: `createRequire` + `__betterSqlite3` escape hatch, and WAL mode (so CLI commands and dev server can read the same `.telescope.db` concurrently). Both are in CLAUDE.md, neither is in source.

### A5 — Clean up `.map(...).join('')` SafeString pattern in `views.ts`

**File:** `packages/telescope/src/views/vanilla/details/views.ts:477,500`

`renderToolCalls` and `renderSteps` do:
```ts
const items = toolCalls.map(tc => html`...`).join('')
return raw(items)
```

This works (each `SafeString.toString()` returns its raw value, then `raw()` re-wraps), but it's the *footgun pattern* CLAUDE.md flags. The idiomatic version:
```ts
return html`${toolCalls.map(tc => html`...`)}`
```

`html`` natively handles `SafeString[]` via `renderHtmlValue`'s array branch. Drops the `raw()` re-wrap and removes the footgun shape from the codebase so future copy-paste of this code doesn't reintroduce the bug elsewhere.

**Verify:** snapshot rendering equality of `AiView` against an entry with toolCalls + steps before/after (one test in PR C will pin this).

### A6 — Tighten `SqliteStorage` constructor cast

**File:** `packages/telescope/src/storage.ts:125`

```ts
// Current
this.db = new (Database as unknown as new (path: string) => import('better-sqlite3').Database)(this.dbPath)

// New — narrow via a typed alias defined once near the import block
type BetterSqliteCtor = new (path: string) => import('better-sqlite3').Database
this.db = new (Database as BetterSqliteCtor)(this.dbPath)
```

Removes one `as unknown as`. Pure visual; same runtime behavior.

### A7 — Extract `attachBatchId(req, batchId)` helper in request collector

**File:** `packages/telescope/src/collectors/request.ts:46,65,70`

Three `(req as unknown as Record<string, unknown>)['__telescopeBatchId' | 'statusCode' | 'ip']` casts in the same file, same shape as sanctum #427 and session #428. Centralize:

```ts
type ReqBag = Record<string, unknown>
const reqBag = (r: unknown): ReqBag => r as ReqBag

// Call sites
reqBag(req)['__telescopeBatchId'] = batchId
const status = reqBag(res)['statusCode'] as number | undefined
const rawIp = reqBag(req)['ip'] as string | undefined
```

Or define typed accessors:
```ts
function setBatchId(req: AppRequest, id: string): void {
  ;(req as unknown as ReqBag)['__telescopeBatchId'] = id
}
function getStatus(res: unknown): number | undefined { ... }
function getRequestIp(req: unknown): string | undefined { ... }
```

Pick the shape that produces the fewest lines. Net: 3 casts → 1 in helpers, 0 at call sites.

### A8 — Audit collector peer-bridge casts (decide, don't necessarily fix)

**Files:** `packages/telescope/src/collectors/{ai,mcp,model,notification,query,schedule,mail}.ts`

8 casts of the shape `mod.X as unknown as { ... interface ... }` where `X` is a peer-package observer registry or framework registry. Each collector defines its own minimal interface inline.

These are **load-bearing** because:
- Importing the peer-package types would create a circular peer dep (telescope is *downstream* of ai/mcp; the collectors are bridges)
- Each interface is minimal (just `subscribe(...)` or `getModels()`) — pulling full types is overkill

**Decision:** document the pattern with a one-line JSDoc on each cast (`// Bridge cast — telescope can't import @rudderjs/ai types without inverting the dependency`) and leave as-is. **Do not** introduce a shared `observerBridge<T>()` helper — the per-collector shape is the point; a generic obscures it. Add this rationale to the package CLAUDE.md so the next audit doesn't relitigate.

### A-Verify

```bash
pnpm --filter @rudderjs/telescope typecheck
pnpm --filter @rudderjs/telescope test
pnpm --filter @rudderjs/telescope lint
pnpm typecheck    # repo-wide
```

Cast count check:
```bash
grep -rn "as unknown as\|as any" packages/telescope/src/ | wc -l
```
Expect 12 → ~8 (3 from A7, 1 from A6; remaining 8 are A8's load-bearing bridges).

**PR title:** `docs(telescope): document hidden contracts; clean SafeString join footgun; centralize req raw-bag access`
**Changeset:** none — internal cleanup with no behavior change. (A5 is a refactor of working code, not a fix.)

---

## PR B — Split `views/vanilla/details/views.ts`

**Branch:** `refactor/telescope-views-split`

`views.ts` is 703 LOC: 19 `ViewFn` declarations + 4 shared helpers (`escape`, `formatTimestamp`, `formatBytes`, `statusColor`) + 2 ai-specific helpers (`renderToolCalls`, `renderSteps`) + the `detailViews` registry map.

Three clean seams:

| Phase | New file | Symbols | Approx LOC out |
|---|---|---|---|
| B1 | `details/format.ts` | `escape`, `formatTimestamp`, `formatBytes`, `statusColor` | ~50 |
| B2 | `details/request-views.ts` | `RequestView`, `HttpView` (both request-shaped) | ~250 |
| B3 | `details/ai-views.ts` | `AiView`, `renderToolCalls`, `renderSteps` | ~150 |

Expected: `views.ts` 703 → ~250 LOC (keeps `detailViews` registry + 15 simple data renderers).

### B0 — Pre-flight

```bash
cd packages/telescope
pnpm typecheck && pnpm test
```

### B1 — Extract `details/format.ts`

**Step 1: Move helpers**

```bash
grep -n "^function escape\|^function formatTimestamp\|^function formatBytes\|^function statusColor" packages/telescope/src/views/vanilla/details/views.ts
```

Move all four into `format.ts`. **Re-export from `views.ts`** is not needed — they're internal-only (the file has no current external consumers of these helpers).

**Step 2: Update imports** in `views.ts` to read from `./format.js`. Same for any other site (none expected, but verify):

```bash
grep -rn "formatTimestamp\|formatBytes\|statusColor" packages/telescope/src/views/
```

**Step 3: Verify**

```bash
pnpm --filter @rudderjs/telescope typecheck
pnpm --filter @rudderjs/telescope test
pnpm --filter @rudderjs/telescope build
```

### B2 — Extract `details/request-views.ts`

`RequestView` (lines 16–105) and `HttpView` (lines 304–354) are the two largest view functions and share the "request-shape" rendering pattern (status badges, headers/payload tabs). Move them together.

**Step 1:** Move both `const RequestView: ViewFn = ...` and `const HttpView: ViewFn = ...` into the new file. Import helpers from `./format.js` and `./sections.js`.

**Step 2:** Update `detailViews` map in `views.ts` to import them:
```ts
import { RequestView, HttpView } from './request-views.js'
```

**Step 3:** Verify same as B1.

### B3 — Extract `details/ai-views.ts`

`AiView` (lines 504–580) plus its two helpers `renderToolCalls` (441–479) and `renderSteps` (481–502). All self-contained — `renderToolCalls`/`renderSteps` are not called by any other view.

**Step 1:** Move all three symbols. After PR A5, these will look idiomatic (no `.join('')` footgun).

**Step 2:** Import `AiView` from `./ai-views.js` in the `detailViews` map.

### B-Risk notes

- **No public API churn.** `detailViews` is exported from `views.ts`; that export stays. All extracted symbols are internal.
- **Avoid nested directories.** Keep siblings flat under `details/` (matches the existing `Layout.ts`, `sections.ts`, `Batch.ts`, `NotFound.ts` layout).
- **`escape` is also used by `_html.ts`'s sibling code path** — verify nothing outside `details/` reaches into the old `views.ts` for it. (Quick `grep` confirmed nothing currently does.)

### B-Verify (end of phase)

```bash
pnpm --filter @rudderjs/telescope typecheck
pnpm --filter @rudderjs/telescope test
pnpm --filter @rudderjs/telescope lint
pnpm typecheck    # repo-wide
```

Public API check:
```bash
git diff main -- packages/telescope/src/views/vanilla/details/views.ts | grep '^-export' | head
```
Only `detailViews` should be exported from `views.ts` both before and after — no net change.

Manual UI check (recommended, not blocking):
```bash
cd playground && pnpm dev
# Visit /telescope, click into a Request entry, an HTTP entry, and an AI entry — visual parity.
```

**PR title:** `refactor(telescope): split details/views.ts into format, request-views, ai-views siblings`
**Changeset:** none. Internal refactor.

---

## PR C — Test coverage for collectors + storage + slug parity

**Branch:** `test/telescope-collector-coverage`

The biggest single quality win. Today `index.test.ts` covers `createEntry`, `MemoryStorage`, `TelescopeRegistry`, `Telescope` facade, and 6 collectors (Command, Broadcast, Sync, Http, Gate, Dump). **13 collectors have zero unit-test coverage**, `SqliteStorage` has zero coverage, and the list-slug parity contract has zero enforcement.

### C0 — Test infra prep

Today's `package.json`:
```json
"test": "tsc -p tsconfig.test.json && node --test dist-test/index.test.js; EXIT=$?; rm -rf dist-test; exit $EXIT"
```

This lists `index.test.ts` only — new test files won't run (memory: `feedback_orm_test_script_explicit_files`). Two options:

**Option 1 (preferred):** glob the dist-test directory.
```json
"test": "tsc -p tsconfig.test.json && node --test 'dist-test/**/*.test.js'; EXIT=$?; rm -rf dist-test; exit $EXIT"
```

**Option 2:** enumerate every new file. Brittle.

Pick Option 1 in PR C0. Run baseline to confirm nothing breaks.

### C1 — Per-collector test files (13 files)

Add one file per uncovered collector under `packages/telescope/src/collectors/`:

| File | Coverage target |
|---|---|
| `ai.test.ts` | observer registration; record on `ai.run.completed`; redaction of api-key headers; slow-AI threshold flag |
| `cache.test.ts` | hit/miss/put/forget events recorded with correct shape; respects `recordCache: false` |
| `event.test.ts` | observer hooks into `EventBus`; listener name list captured |
| `exception.test.ts` | **load-bearing**: collector swallow (a `record()` that throws does NOT cascade into the error reporter); previousReport chain captured |
| `job.test.ts` | dispatch / processing / processed / failed lifecycle; batchId correlation when inside a request |
| `log.test.ts` | level-filtering; context object captured; respects `recordLogs: false` |
| `mail.test.ts` | `send()` patched (method-as-property pitfall): reading `_subject`/`_to` not `subject`/`to`; bcc/cc captured |
| `mcp.test.ts` | observer registration; record on tool-call completed; slow-MCP threshold |
| `model.test.ts` | observer hooks into all ModelRegistry models; create/update/delete events with diff |
| `notification.test.ts` | channel send event captured per recipient |
| `query.test.ts` | slow-query threshold (default 100ms); SQL + bindings + duration; batchId correlation |
| `request.test.ts` | middleware lifecycle; batchId set on req (`__telescopeBatchId` after A7's helper); ignoreRequests glob; redaction; status extraction from res |
| `schedule.test.ts` | schedule task names + cron strings captured (method-as-property pitfall: `getDescription()`/`getCron()` not `description`/`cron`) |

Pattern (from existing tests):
```ts
// collectors/cache.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryStorage } from '../storage.js'
import { CacheCollector } from './cache.js'

test('CacheCollector records hit events with batch correlation', async () => {
  const storage = new MemoryStorage()
  const collector = new CacheCollector(storage)
  await collector.register()
  // emit a synthetic cache event via the cache observer registry stub
  // assert entries[0].batchId, entries[0].content.key
})
```

Use **observer stubs** (not real peer-package imports) — every collector calls `await import('@rudderjs/<peer>/observers')` and reads a registry off the module. In tests, mock that module via `module.register('node:test')` hooks or by setting the registry directly on `globalThis` before `register()`. The 6 existing collector tests in `index.test.ts` (Command, Broadcast, Sync, Http, Gate, Dump) show the pattern — clone it.

**Reference fixtures:** the playground `/test/<name>` routes (CLAUDE.md: "canonical end-to-end fixtures"). For each collector, the playground fires the real trigger — replicate the same shape in the unit test fixture.

### C2 — `SqliteStorage` test

**File:** `packages/telescope/src/storage.sqlite.test.ts`

Use `better-sqlite3` against `:memory:` (no disk artifacts). Coverage:
- `store()` writes a row; `find()` retrieves it
- `list()` filters by `type`, `batchId`, `tag`, time range; respects `before`/`after` + `limit`
- `count()` matches expected
- `prune()` and `pruneOlderThan()` remove correct rows
- WAL mode actually enabled (`db.pragma('journal_mode')` returns `'wal'`)

Skip if `better-sqlite3` not installable in CI (already an optional dep). Use `test.skip()` with a clear reason.

### C3 — List-slug parity regression test

**File:** `packages/telescope/src/routes.slug.test.ts`

Asserts the contract documented in CLAUDE.md and JSDoc'd in PR A2:
```ts
test('EntryList.apiPath and routes.apiPath agree for every EntryType', () => {
  // Each EntryType in types.ts must produce the same slug from both sites.
  // The 'http'/'ai'/'mcp' stay singular; 'view'→'views'; 'query'→'queries'; rest get 's'.
})
```

If A2 extracted `toApiSlug(type)`, this collapses to "assert against the helper" — but the *value* of this test is that it'll fail if anyone ever inlines either site again. Keep the test even if A2 extracted the helper.

### C4 — Detail view snapshot tests

**File:** `packages/telescope/src/views/vanilla/details/views.test.ts`

Smoke + regression coverage for the three largest watchers (which PR B will split):
- `RequestView` renders for a typical request entry (method, status badge, payload tabs, headers tab, response tab)
- `HttpView` renders for an outgoing HTTP entry
- `AiView` renders for an AI entry with toolCalls + steps (this pins PR A5's refactor — pre/post output must be byte-identical)

Use deterministic fixtures: hardcode `createdAt`, hardcode tags, hardcode all content fields. Assert via `assert.equal(view(fixture).value, expectedSnapshot)` for compactness; or use substring assertions (`assert.ok(out.includes('Payload'))`) if full snapshots feel brittle.

### C-Verify

```bash
pnpm --filter @rudderjs/telescope typecheck
pnpm --filter @rudderjs/telescope test    # ALL new test files run via the glob
pnpm typecheck    # repo-wide
```

Coverage check (informal):
```bash
ls packages/telescope/src/collectors/*.test.ts | wc -l    # expect 19 (matches collector count)
```

**PR title:** `test(telescope): cover 13 untested collectors, SqliteStorage, list-slug parity, detail-view rendering`
**Changeset:** none — tests are not user-facing.

---

## What's NOT in this plan

These came up in the audit but are deliberately out of scope:

| Item | Why deferred |
|---|---|
| `index.ts` split (234 LOC: facade + provider) | Borderline size; the 35-line config-resolution block is the only awkwardness and it's straightforward to read. Revisit if telescope grows another collector with config keys. |
| `storage.ts` split (`MemoryStorage` + `SqliteStorage` siblings) | 248 LOC, fits cleanly in one file; both implementations are short. Split only adds barrel files. |
| `views/vanilla/Layout.ts` + `details/Layout.ts` (242 LOC each) | Cohesive single-page render functions; splitting would fragment the dark-mode/Tailwind contract that's the point of having them together. |
| `views/vanilla/columns.ts` (231 LOC) | Per-watcher column definitions — naturally tabular, would not benefit from a split. |
| `collectors/request.ts` (209 LOC) | Largest collector but coherent (one class, one middleware function). PR A7 + C1's `request.test.ts` are the two real wins. |
| 8 peer-bridge casts in collectors | Load-bearing — see A8 rationale. |
| `dump` collector caller-line bug in Vite SSR dev | Known dev-mode limitation from Vite Module Runner's `new Function()` eval; production is correct. Out of scope to fix here (would need Vite-side change). |
| Recording API HTTP endpoint tests | API routes in `api/routes.ts` are 128 LOC and route through the request collector's middleware. End-to-end coverage exists via playground; unit-level coverage is lower-leverage than collector tests. |

---

## Wrap-up

After all three PRs land:

```bash
pnpm --filter @rudderjs/telescope typecheck
pnpm --filter @rudderjs/telescope test
pnpm --filter @rudderjs/telescope lint
pnpm build
git log --oneline main..HEAD | head -20
```

**Expected line counts:**
- `packages/telescope/src/views/vanilla/details/views.ts`: 703 → ~250 (−65%)
- New siblings: `details/format.ts`, `details/request-views.ts`, `details/ai-views.ts`
- New test files: ~16 (`collectors/*.test.ts` per gap + `storage.sqlite.test.ts` + `routes.slug.test.ts` + `views.test.ts`)
- Test files total: 1 → ~17

**Public API check:**
```bash
git diff main -- packages/telescope/src/index.ts | grep '^-export' | head
```
Zero `-export` lines expected. No public surface change across A–C.

**Risk notes:**
- A5 (the `.join('')` cleanup) is the only behavior-adjacent change. PR C4's `AiView` snapshot test pins pre/post equality — write that test *before* A5 lands, then carry it forward.
- C2's `SqliteStorage` test requires `better-sqlite3` installed in CI. Confirm `pnpm install` resolves it before merging C; otherwise the test silently skips.
- C1 collector tests should not require the peer packages they bridge (`@rudderjs/ai`, `@rudderjs/mcp`, etc.) — stub the observer registry on `globalThis` before `collector.register()`. Adding real peer deps to telescope's devDependencies would invert the dependency graph.

---

## Sequencing

Recommended order: **A → B → C**.

- **A** can ship in isolation (small, low-risk).
- **B** can ship after A or in parallel — B doesn't touch the symbols A modifies.
- **C** depends on A7 (`attachBatchId` helper for the `request.test.ts` assertions) and A5 (`AiView` snapshot pre-baseline). Run C last.

If parallelizing B and A: B touches `views/vanilla/details/views.ts` and `format.ts`; A touches `index.ts`, `routes.ts`, `EntryList.ts`, `collectors/exception.ts`, `storage.ts`, `collectors/request.ts`, and the `.join('')` lines in `views.ts`. Only `views.ts` overlaps — coordinate A5 and B together (do A5 first, then B carries the cleaned-up `renderToolCalls`/`renderSteps` into `ai-views.ts`).
