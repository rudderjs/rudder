# Graduate Deferred 0.x Packages to 1.0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Graduate the 4 packages deferred from the 2026-04-28 1.0 cut (`http`, `image`, `concurrency`, `process`) to 1.0.0, dogfooding each in the playground first to surface API friction before committing to a stable contract.

**Architecture:** Per-package loop — *build playground demo → browser verify → fix API friction → review README → cut 1.0 changeset → commit.* HTTP is already dogfooded so it skips the demo step. Each package ships in its own commit; all 4 release in one coordinated `pnpm changeset:version && pnpm release` at the end.

**Tech Stack:** Node 20+, pnpm workspaces, Changesets, `node:test`, Vike + Vite (playground), per-package optional peers (`sharp` for image, none for concurrency/process/http).

**Status today (verified 2026-05-02):**

| Package | Version | LOC (src+test) | Real usage |
|---|---|---|---|
| `@rudderjs/http` | 0.0.2 | 982 | ✓ playground/routes/web.ts + Telescope HTTP collector |
| `@rudderjs/image` | 0.0.1 | 726 | ✗ pinned in playground, never imported |
| `@rudderjs/concurrency` | 0.0.1 | 303 | ✗ no usage anywhere |
| `@rudderjs/process` | 0.0.1 | 592 | ✗ no usage anywhere |

**Deferral rationale (from `docs/plans/2026-04-28-1x-graduation.md`):**
> "concurrency, image, process — all at 0.0.1, not yet exercised in the playground/dogfood loop. http — at 0.0.2, small surface but recent."

**Why dogfood matters:** 1.0 is a public API stability commitment. Once shipped, every breaking change becomes a real major bump. Surfacing friction *before* the lock-in is cheap; surfacing it *after* costs every consumer a migration. Each demo below is genuinely small (1 view + 1-2 routes) — the cost is hours, not days.

---

## Phase order rationale

1. **HTTP first** — already dogfooded, low risk, gets a quick win.
2. **Image second** — has Sharp peer, pairs with Storage which is already in playground.
3. **Process third** — small surface, simple "run a shell command" demo.
4. **Concurrency last** — most niche; the demo can build on Image if useful (parallel resize).

Each is independent — if one reveals a major API problem, the others can still proceed.

---

## Phase 1 — Graduate `@rudderjs/http` to 1.0.0

**Why first:** Already used in `playground/routes/web.ts:?` (dynamic import) and `packages/telescope/src/collectors/http.ts` (observer collector). Has a `/observers` subpath following the canonical observer-registry pattern (memory `reference_observer_registry_pattern`). Surface is mature relative to its version number.

### Task 1.1: Audit the public API surface

**Files:**
- Read: `packages/http/src/index.ts` (614 lines)
- Read: `packages/http/src/observers.ts` (68 lines)
- Read: `packages/http/README.md`

**Step 1: List exported symbols**

```bash
grep -nE "^export " packages/http/src/index.ts
```

Capture every exported symbol, type, and class. These become the 1.0 contract.

**Step 2: Cross-check README against exports**

Verify every documented symbol exists; verify every exported symbol has README coverage. Report any mismatches in a short note (skip the note if everything aligns).

**Step 3: Run existing tests**

```bash
cd packages/http && pnpm test
```

Expected: PASS. If FAIL, stop and fix before graduating.

**Step 4: No commit yet** — audit is research.

### Task 1.2: Spot-check the playground integration

**Files:**
- Read: `playground/routes/web.ts` (find the `Http` import block)

**Step 1: Locate the existing usage**

```bash
grep -n "@rudderjs/http" playground/routes/web.ts
```

**Step 2: Run the playground and exercise the route**

```bash
cd playground && pnpm dev
# In another terminal or browser, hit whichever route uses Http
```

**Step 3: Check Telescope captures the HTTP entry**

Open `/telescope`, find the request you just made, verify the HTTP entry shows up under the related entries.

**Step 4: No commit** — verification only.

### Task 1.3: Write the changeset and commit

**Files:**
- Create: `.changeset/graduate-http-to-1-0.md`

**Step 1: Write the changeset**

```markdown
---
'@rudderjs/http': major
---

Graduate to 1.0.0. The `Http` facade, fluent request builder, observer registry (`@rudderjs/http/observers`), and `Http.fake()` testing helpers are now stable. Future breaking changes will be flagged with major bumps and migration notes.
```

**Step 2: Verify changeset CI run shape**

```bash
pnpm changeset status
```

Expected output mentions `@rudderjs/http` will bump to `1.0.0`.

**Step 3: Commit (changeset only)**

```bash
git add .changeset/graduate-http-to-1-0.md
git commit -m "feat(http)!: graduate to 1.0.0"
```

---

## Phase 2 — Dogfood + graduate `@rudderjs/image`

**Why second:** Has a Sharp peer dep; pairs naturally with Storage (which the playground already wires up). The dogfood demo is "upload an avatar, resize it, save it to public storage."

### Task 2.1: Audit the public API surface

Same pattern as 1.1. Specifically watch for:
- Whether `image()` accepts all the documented input types (Buffer, file path, ReadableStream)
- Whether `optimize()`'s "smart defaults" are documented
- Whether the `lossless()` / `quality()` interaction is consistent

### Task 2.2: Build the avatar-resize demo in playground

**Files:**
- Modify: `playground/package.json` (the dep is already pinned — just confirm)
- Create or modify: `playground/app/Views/Demos/AvatarUpload.tsx` (new view)
- Modify: `playground/routes/web.ts` (add `GET /demos/avatar-upload`)
- Modify: `playground/routes/api.ts` (add `POST /api/avatar` — accepts upload, resizes, saves)
- Modify: `playground/app/Views/Demos/Index.tsx` (link to the new demo)
- Optionally modify: `playground/app/Modules/` (if a service helper makes the route cleaner)

**Step 1: Install Sharp peer if missing**

```bash
cd playground && pnpm add sharp
```

**Step 2: Write the API route (TDD)**

Write a test in `playground/app/Modules/Avatar/AvatarService.test.ts` (or inline integration) that:
- Takes a fixture image buffer
- Calls the avatar pipeline
- Asserts output dimensions (e.g. 256×256), format (webp), size cap

Run: FAIL.

**Step 3: Implement using `@rudderjs/image`**

```ts
import { image } from '@rudderjs/image'
import { Storage } from '@rudderjs/storage'

const buf = await image(file).resize(256, 256).format('webp').quality(85).toBuffer()
await Storage.disk('public').put(`avatars/${userId}.webp`, buf)
return Storage.disk('public').url(`avatars/${userId}.webp`)
```

Run: PASS.

**Step 4: Write the view (semantic CSS, not Tailwind raw)**

`AvatarUpload.tsx` — file input, preview, upload button. Match `Welcome.tsx`/`Contact.tsx` styling pattern.

### Task 2.3: Browser-verify the demo end-to-end

**Step 1: Start the playground**

```bash
cd playground && pnpm dev
```

**Step 2: Use the demo**

- Navigate to `/demos/avatar-upload`
- Upload a real photo
- Verify the resized image appears at the public URL
- Verify Telescope shows the request entry (and image processing if instrumented)

**Step 3: Capture API friction**

Note any pain points: awkward types, missing helpers, surprising defaults, error messages that didn't help. Each one is a 1.0 candidate fix.

### Task 2.4: Fix any friction surfaced

For each item from 2.3, decide:
- **Fix now** (small surface change before 1.0 lock-in) — make the change in `packages/image/src/`, update README, re-run demo.
- **Document and defer** (legitimate behavior, just unexpected) — update README to set expectations.
- **Accept as is** (judgment call, not worth changing).

Each fix is its own commit:
```bash
git commit -m "fix(image): <specific friction point>"
```

If no friction surfaces (best case), skip this task.

### Task 2.5: Cut the 1.0 changeset

**Files:**
- Create: `.changeset/graduate-image-to-1-0.md`

```markdown
---
'@rudderjs/image': major
---

Graduate to 1.0.0. The `image()` fluent processor (resize, crop, format, quality, lossless, optimize, stripMetadata, toBuffer, toFile) is now stable. Sharp remains an optional peer dependency.
```

**Step 1: Commit the changeset + the demo**

```bash
git add .changeset/graduate-image-to-1-0.md playground/
git commit -m "feat(image)!: graduate to 1.0.0 + playground avatar-resize demo"
```

---

## Phase 3 — Dogfood + graduate `@rudderjs/process`

**Why third:** Smallest surface (378 LOC). Demo: "show system info" — reads `git rev-parse HEAD` + `node --version` + free memory via shell.

### Task 3.1: Audit API surface

Same pattern as Tasks 1.1 / 2.1.

### Task 3.2: Build the "system info" demo

**Files:**
- Create: `playground/app/Views/Demos/SystemInfo.tsx`
- Modify: `playground/routes/web.ts` (add `GET /demos/system-info`)
- Modify: `playground/routes/api.ts` (add `GET /api/system-info` — runs shell commands, returns JSON)
- Modify: `playground/app/Views/Demos/Index.tsx`

**Step 1: Implement the API route**

```ts
import { process as runProcess } from '@rudderjs/process'  // confirm exact API name

const [git, node, uptime] = await Promise.all([
  runProcess.run('git rev-parse --short HEAD'),
  runProcess.run('node --version'),
  runProcess.run('uptime'),
])
return res.json({ git: git.stdout.trim(), node: node.stdout.trim(), uptime: uptime.stdout.trim() })
```

(Confirm the actual facade name from `packages/process/README.md` before writing — don't guess.)

**Step 2: View** — semantic CSS, polls or refreshes on click.

### Task 3.3: Browser-verify

```bash
cd playground && pnpm dev
# /demos/system-info — verify all three values render
```

### Task 3.4: Fix friction surfaced

Same pattern as 2.4. Common things to watch for in shell-exec libraries:
- Are stderr and stdout cleanly separated?
- Does timeout behavior throw a useful error?
- Is the API safe against shell injection (or does the README warn loudly)?

### Task 3.5: Cut changeset + commit

```markdown
---
'@rudderjs/process': major
---

Graduate to 1.0.0. The shell execution facade (run, pool, pipe, fake) is now stable.
```

```bash
git commit -m "feat(process)!: graduate to 1.0.0 + playground system-info demo"
```

---

## Phase 4 — Dogfood + graduate `@rudderjs/concurrency`

**Why last:** Most niche. Demo: CPU-bound work in a worker thread so the request handler stays responsive. Easiest concrete example: "compute Fibonacci(40) in a worker." If Image graduated cleanly, an alternative demo is "batch resize 5 images in parallel" — pairs nicely.

### Task 4.1: Audit API surface

Same pattern. Pay attention to:
- Worker entry contract (what gets passed across the boundary?)
- Sync driver toggle (per README — used for testing)
- How errors propagate from worker → main thread

### Task 4.2: Pick the demo

Two options — pick one based on Phase 2 outcome:

**Option A — Fibonacci (always works, decoupled from Image):**
- Worker computes `fib(n)` for a user-provided `n`
- Main thread stays responsive — demo includes a counter that ticks while the worker runs

**Option B — Parallel image resize (depends on Phase 2 success):**
- User uploads N images
- Main thread dispatches each resize to a worker pool
- Returns a gallery of resized URLs

**Default to A** — simpler, more obviously demonstrates the point. Only do B if it's clearly cheap after Phase 2.

### Task 4.3: Build the demo

**Files:**
- Create: `playground/app/Views/Demos/WorkerCpu.tsx` (Option A) or `WorkerResize.tsx` (Option B)
- Create: `playground/app/Workers/<name>.ts` (worker entry — depends on package's API for registering work)
- Modify: `playground/routes/web.ts` + `routes/api.ts`
- Modify: `playground/app/Views/Demos/Index.tsx`

Implementation depends on the actual API — read README first.

### Task 4.4: Browser-verify

Visit the demo, kick off CPU work, verify the page stays interactive while it runs (this is the whole point of the package).

### Task 4.5: Fix friction + cut changeset

```markdown
---
'@rudderjs/concurrency': major
---

Graduate to 1.0.0. Worker-thread parallelism, fire-and-forget defer, and sync driver for testing are now stable.
```

```bash
git commit -m "feat(concurrency)!: graduate to 1.0.0 + playground worker demo"
```

---

## Phase 5 — Coordinated release

After all 4 packages have changesets in place and all friction fixes are committed, do one release.

### Task 5.1: Verify changeset state

```bash
pnpm changeset status
```

Expected: 4 packages bumping to 1.0.0 + any cascade-major bumps on dependents (telescope listens to `@rudderjs/http/observers`, so it will cascade-major).

### Task 5.2: Run version-bump

```bash
pnpm changeset:version
```

This rewrites the 4 package.json files + CHANGELOGs and creates the version PR. Review the diff carefully — especially what cascades on telescope/pulse/horizon dependencies. None of those should breaking-change *meaningfully* — they're just version-bump cascades.

### Task 5.3: Commit version bumps + open release PR

```bash
git add .
git commit -m "chore: version packages — graduate http/image/process/concurrency to 1.0"
git push -u origin <branch>
gh pr create --title "chore: graduate http/image/process/concurrency to 1.0.0"
```

### Task 5.4: Merge + release

After PR approval and CI green:

```bash
git checkout main && git pull
pnpm release   # publishes the bumped packages to npm
```

If the Changesets-bot version-packages PR doesn't trigger CI (per memory `feedback_changesets_bot_ci`), close + reopen it to unstick.

### Task 5.5: Verify on npm

```bash
for pkg in http image process concurrency; do
  npm view @rudderjs/$pkg version
done
```

Expected: each shows `1.0.0`.

(Per memory `feedback_npm_first_publish_404_cache` — if `npm view` lies, fetch the version-specific URL directly.)

---

## Phase 6 — Hand-off to scaffolder refresh

With all 4 at 1.0, the scaffolder refresh plan (`docs/plans/2026-05-02-scaffolder-refresh.md`) gains four more rows from day one:

- **Image** → Infrastructure category
- **HTTP, Concurrency, Process** → Utilities category

Update the scaffolder plan's "Out of scope" section to remove the deferred-package note, and add a small task in scaffolder Phase 2 to wire all 4 into the multiselect.

```bash
# Inside the scaffolder-refresh worktree (when that work starts):
# Edit docs/plans/2026-05-02-scaffolder-refresh.md to:
# 1. Remove the "0.x packages awaiting graduation" bullet from "Out of scope"
# 2. Add Image to the Infrastructure category in Phase 2
# 3. Add HTTP/Concurrency/Process to the Utilities category
# 4. Add a Task 2.3.x line: "Wire image, http, concurrency, process deps + config"
```

---

## Cross-phase invariants

- **`pnpm test && pnpm typecheck`** must pass before any commit.
- **Browser-verify in playground** before committing each demo (memory `feedback_browser_verify_finds_real_bugs` — cross-process / real-runtime bugs are invisible to unit tests).
- **One changeset per package** — keeps the release log readable.
- **Don't graduate any package whose audit reveals a non-trivial API problem.** Drop it from this batch and add it to a follow-up. Better to ship 3 of 4 cleanly than ship 4 with regret.

## Out of scope (defer)

- New features inside any of the 4 packages — only fix surfaced friction; new functionality is a separate PR.
- Demos for HTTP — already exercised in playground; no new demo needed for graduation.
- Updating the scaffolder itself — that's `docs/plans/2026-05-02-scaffolder-refresh.md` and runs after this plan completes.
- Migrating other packages' optional dependence on these to required dependence — coupling decisions live with the consumers, not this graduation.
