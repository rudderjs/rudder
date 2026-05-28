# Framework Quality + DX Sweep — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. This plan is **multi-session** — keep the Status table in sync as you go.

**Goal:** Audit four under-swept axes of the 1.0+ framework — scaffolder stubs, error-message actionability, `@rudderjs/testing` ergonomics, public API surface hygiene — and ship the resulting fixes via the same investigate-report-fix cadence as today's dogfooding round (#726–#732).

**Architecture:** Four independent phases, executed one at a time. Each phase = **pre-flight (verify the gap is real) → investigation (Explore/general agents OK) → prioritized findings report → user scope decision → fix PRs (small, one-per-cluster, per-package changesets) → post-flight (CI green, merged, status updated)**. No phase starts until the previous one's checkpoint is signed off.

**Tech Stack:** TypeScript strict ESM monorepo (pnpm + Turbo), Vike + Vite, 48 published `@rudderjs/*` packages, Changesets release, GitHub Actions CI (CodeQL ruleset on `main`), `node --test --experimental-test-module-mocks` for unit tests.

---

## Status & Checkpoints

Update this table at the start and end of every session. Treat unchecked rows as the to-do queue.

| Phase | State | Branch / PR(s) | Findings doc | Notes |
|---|---|---|---|---|
| 0. Plan-doc landed | ⬜ | `docs/plan-quality-dx-sweep` → PR TBD | this file | merge before Phase 1 starts |
| 1. Scaffolder stub audit | ⬜ | — | `docs/plans/findings/2026-05-28-phase-1-scaffolder-stubs.md` (created in Task 1.5) | — |
| 2. Error-message actionability | ⬜ | — | `docs/plans/findings/2026-05-28-phase-2-error-messages.md` | — |
| 3. `@rudderjs/testing` ergonomics | ⬜ | — | `docs/plans/findings/2026-05-28-phase-3-testing-ergonomics.md` | likely `feat:` (new APIs) — minor bumps |
| 4. Public API surface review | ⬜ | — | `docs/plans/findings/2026-05-28-phase-4-public-api.md` | high stakes — any *removal* is a major bump; default to `@internal` markers |

Legend: ⬜ not started · 🟡 in progress · ✅ done · ⏸ paused (record reason in Notes)

---

## Cross-phase rules (apply to every PR)

1. **Branch off latest `main`** for every PR; never extend an open PR's branch (memory: "Don't touch branches with an open PR").
2. **One PR per finding cluster.** If five packages have the same stub bug, that's one PR touching five packages with five changesets. If five packages have *unrelated* bugs, that's five PRs. Cluster by *cause*, not by *file count*.
3. **Changeset policy (per CLAUDE.md):**
   - Runtime fix in a published package → `patch` changeset.
   - New public API → `minor` changeset; commit with `feat:`.
   - Breaking change → `major` (avoid in 1.x unless explicitly authorized).
   - Docs / test-only / internal refactor → **no** changeset.
4. **PR title prefix** matches the change kind: `fix:`, `feat:`, `refactor:`, `docs:`, `chore:`, `test:`. For an audit-driven sweep across multiple packages, the prefix is determined by the *dominant* change kind.
5. **Verify before committing** — `pnpm typecheck && pnpm test && pnpm build` from root for runtime PRs; at minimum `pnpm typecheck` for docs.
6. **No `Co-Authored-By: Claude`** in commits (recorded preference).
7. **Pre-flight memory check** at the start of each phase — if memory claims an area is already swept, verify in code FIRST. The boost-coverage drift (memory said "3/20"; reality "45/45") is the canonical example of why.
8. **Each phase produces a findings doc** in `docs/plans/findings/` BEFORE fix PRs are opened. The findings doc is what the user signs off against.

---

## Plan-doc landing (Phase 0)

Get this file into `main` before Phase 1 starts, so subsequent phase work can reference it by URL.

### Task 0.1: Open plan-doc PR

**Files:**
- Create: `docs/plans/2026-05-28-quality-dx-sweep.md` (this file)

**Step 1:** Branch (already done): `docs/plan-quality-dx-sweep`.
**Step 2:** Commit with `docs: add quality + DX sweep plan (4-phase audit)`.
**Step 3:** Push and open PR.
**Step 4:** Wait for CI green and user merge. Update Status row 0 to ✅ on merge.

**No changeset** — `docs/plans/*` is `srcExclude`d from the vitepress site (memory) and not published.

---

## Phase 1 — Scaffolder stub quality

**Why now:** Today's dogfooding round caught `make:terminal` generating a broken `.ts` file with JSX and the wrong filename suffix (#726). The class of bug is *structural* — wrong extension, wrong filename, won't compile, won't resolve. Other `make:*` stubs almost certainly carry similar latent issues. Today's run only catches what gets *run*; this phase catches what *should be runnable*.

### Task 1.1: Pre-flight — enumerate every `make:*` command

**Step 1:** From repo root:
```bash
grep -rEh "make:[a-z-]+" packages/*/src 2>/dev/null \
  | grep -oE "make:[a-z-]+" | sort -u
```
**Expected output:** A list like `make:command, make:controller, make:event, make:factory, make:job, make:listener, make:mail, make:middleware, make:migration, make:model, make:notification, make:provider, make:request, make:resource, make:seeder, make:terminal, …` — the canonical set.

**Step 2:** For each command, locate the `MakeSpec` (the stub registration). Most live alongside their owning package, e.g. `packages/terminal/src/make-terminal.ts`. Capture: command name, owning package, target file pattern, target extension, stub content source.

**Step 3:** Write the inventory to `docs/plans/findings/2026-05-28-phase-1-scaffolder-stubs.md` under a `## Inventory` heading as a markdown table:

| Command | Package | Target path pattern | Extension | Stub source file |
|---|---|---|---|---|

This table is the work surface for Tasks 1.2–1.4.

### Task 1.2: Define the verification rubric

In the findings doc, under `## Rubric`, capture the checks each stub must pass:

1. **Filename correctness** — generated filename matches the documented resolver pattern (e.g. `terminal('dashboard')` → `app/Terminal/Dashboard.tsx`, not `app/Terminal/DashboardTerminal.ts`).
2. **Extension correctness** — JSX-bearing stubs must be `.tsx`; pure-TS stubs `.ts`.
3. **Compiles** — generated file passes `tsc --noEmit` in a freshly scaffolded playground.
4. **Resolves at runtime** — the documented runtime resolver (`terminal('id')`, `view('id')`, `dispatch(JobClass)`, etc.) finds the generated file.
5. **Matches docs** — the documented usage example in `docs/guide/*.md` actually works against the generated stub.

### Task 1.3: Programmatic sweep (no app required)

For each command in the inventory, read the `MakeSpec` source and check rubric items 1–2 (static analysis, no codegen needed).

**Step 1:** For each stub source, verify:
   - The `extension` field (defaults to `'ts'` since `@rudderjs/console@1.2.0`) — flag any mismatch with the stub body (JSX content but `.ts` extension = bug).
   - The filename transform (any `Pluralize`, suffix-appending, lowercase logic) — flag suffixes the runtime resolver doesn't expect.

**Step 2:** Update findings doc with a `## Static-analysis findings` section, grouped as `🔴 broken / 🟡 drift / 🟢 clean`, each with `package:line` references.

### Task 1.4: End-to-end sweep (scaffold + compile + resolve)

This catches dynamic bugs static analysis misses.

**Step 1:** From `playground/`:
```bash
for cmd in command controller event factory job listener mail middleware migration model notification provider request resource seeder terminal; do
  echo "=== make:$cmd Test ==="
  pnpm rudder make:$cmd Test 2>&1 | tail -3
done
```
Capture the output (success/failure) and the actual files generated. **Reset** between commands (`git status app/` then `git checkout app/` or delete) to keep results independent.

**Step 2:** Run `pnpm typecheck` from `playground/` after each generation. Compile errors → `🔴`.

**Step 3:** For each command with a runtime resolver (`view`, `terminal`, queueable jobs, etc.), boot the playground and trigger the resolver. Resolver-not-found → `🔴`.

**Step 4:** Update findings doc with `## End-to-end findings`.

### Task 1.5: Compile the findings report

Move all findings into the report doc. Final structure:

```markdown
# Phase 1 Findings — Scaffolder stub audit
## Inventory
## Rubric
## Static-analysis findings (🔴/🟡/🟢)
## End-to-end findings (🔴/🟡/🟢)
## Recommended fix clusters
## Out-of-scope / deferred
## Overall assessment (1 paragraph)
```

Findings get grouped into **fix clusters** — packages that share a root cause and ship in one PR.

### Task 1.6: User checkpoint

Present the findings report with a scope question (Hi/Med/Low; per cluster). Block on user decision before any code edits. Treat unanswered or ambiguous decisions as **stop and ask**, not **assume**.

### Task 1.7: Implement fix clusters

For each authorized cluster:

**Step 1:** Branch off latest `main`, name `fix/make-<scope>` or `feat/make-<scope>`.
**Step 2:** TDD where possible — add a test that scaffolds the stub and asserts compile + resolve. Make it fail. Implement. Make it pass. (Today's dogfooding fixes were straight bug fixes without prior tests; for this audit phase, prefer adding the test so the regression class is locked.)
**Step 3:** Per-package changeset (patch) for every package whose runtime stub changes. No changeset for test-only changes.
**Step 4:** `pnpm typecheck && pnpm test && pnpm build` from root.
**Step 5:** Commit (no Claude attribution). Push. Open PR linking back to the findings doc and the cluster.
**Step 6:** Wait for CI green. Wait for explicit merge auth (per "PR actions need explicit auth").
**Step 7:** After merge, check the auto-opened `chore: version packages` PR (changesets-action) — its CI may need a close+reopen re-trigger if `GITHUB_TOKEN` push starves the required-checks ruleset (today's #727 hit this).

### Task 1.8: Phase 1 post-flight

**Step 1:** Update Status row 1 to ✅, fill PR list and findings-doc path.
**Step 2:** Update memory:
   - If the audit changed our understanding of what's swept (e.g. "stubs are now all uniform"), add/update a project memory.
   - Don't add per-finding memories — those are PR history, not future-relevant context.
**Step 3:** Sync site repo if any framework `docs/` file changed (Today's pattern: framework PR → `docs:sync` PR on rudderjs-com).

---

## Phase 2 — Error message actionability

**Why now:** #731 fixed ORM CLI errors (stack trace → one-line `CliError`). That fixed *one* surface. The other runtime surfaces — validation, auth, middleware, server, router — haven't been audited as a unified sweep against an "actionable" rubric.

### Task 2.1: Pre-flight — define the actionability rubric

In `docs/plans/findings/2026-05-28-phase-2-error-messages.md`, capture the criteria a good runtime error meets:

1. **Identifies the problem** in one sentence (no stack trace as the primary signal).
2. **Identifies the cause specifically** — not "X is undefined" but "X is undefined because <reason>".
3. **States a next step** — "Run `pnpm rudder X`" / "Add `Y` to your config" / "See docs at /guide/Z" / "Check that the package is installed".
4. **Includes the failing input** when safe (the missing key, the offending path, etc.).
5. **Renders cleanly** in both the rudder CLI (`CliError` path) and the dev Ignition page (stack + code frame).

### Task 2.2: Per-surface inventory

For each runtime surface — **validation, ORM (queries + adapters), auth (session + token), middleware, server-hono, router** — enumerate the error classes that the framework throws *at user code*. Skip internal-only errors that never escape.

Use `grep -rE "throw new [A-Z][a-zA-Z]*Error" packages/<pkg>/src` per surface and triage by call-site (does the user trigger it?).

Capture in the findings doc as a per-surface table: error class, where thrown (`file:line`), trigger condition.

### Task 2.3: Rate every escapable error against the rubric

For each error in the inventory, score 1–5 against the rubric. Anything ≤ 3 = candidate for improvement.

**Subtask:** for each candidate, draft a one-line proposed message AND the "next step" snippet, in the findings doc.

### Task 2.4: Dogfood validation pass

For each candidate, *trigger* the error in the playground (or write a minimal repro) and confirm the actual rendered output matches the source. Some errors get post-processed (`server-hono`'s error renderer, the Ignition page) — the rendered string is what counts.

### Task 2.5–2.8: Mirror Phase 1 (findings → checkpoint → implement → post-flight)

Same structure as Phase 1. Fix PRs likely cluster by package (one PR per package that owns ≥1 candidate). Default to `patch` changesets; if a message change is part of a documented API contract (rare), case-by-case.

---

## Phase 3 — `@rudderjs/testing` ergonomics

**Why now:** Application authors writing tests today use `@rudderjs/testing` + Node's built-in test runner. Laravel's `TestCase` ships factories, `actingAs`, `expectsJobs`/`assertDispatched`, mail/event/notification fakes, HTTP test helpers — all surfaces a Rudder user is likely to expect. We have *some* of this; the gap analysis hasn't been done in one place.

**Risk:** This phase is more likely than the others to produce **new public API** (e.g. `actingAs(user)`, `Mail.fake()` parity, route-test client). New APIs = `feat:` + `minor` bump. Plan for that, and surface to the user at the scope-decision checkpoint.

### Task 3.1: Map the current testing surface

**Step 1:** Read `packages/testing/src/index.ts` and every re-export. Capture every public function/class.
**Step 2:** Read `docs/guide/testing.md` end-to-end. Capture every documented helper.
**Step 3:** Cross-check the two — anything in the source not in the docs, or vice versa, is a finding.
**Step 4:** Write a `## Current surface` section to the findings doc.

### Task 3.2: Build the Laravel parity matrix

Reference: Laravel 11 / 12 testing docs (`https://laravel.com/docs/12.x/testing`, `…/http-tests`, `…/database-testing`, `…/mocking`). Use `WebFetch` to read live docs — don't trust training data (recorded preference: "Verify before pitching DX gaps").

In the findings doc, build a table:

| Laravel helper | RudderJS equivalent (today) | Gap / notes |
|---|---|---|
| `actingAs($user)` | `?` | … |
| `assertAuthenticated()` | `?` | … |
| `expectsJobs(JobClass)` | `?` | … |
| `Bus::fake(); assertDispatched()` | `?` | … |
| `Mail::fake(); assertSent()` | `MailFake` (exists?) | … |
| `Notification::fake()` | `?` | … |
| `Event::fake()` | `?` | … |
| `Queue::fake()` | `?` | … |
| `Storage::fake()` | `?` | … |
| `Http::fake()` | `?` | … |
| `$this->get('/path')` HTTP test | `?` | … |
| `assertDatabaseHas` | `?` | … |
| `RefreshDatabase` / `DatabaseTransactions` | `?` | … |
| Factories (`User::factory()->count(5)->create()`) | `factory()` (shipped 2026-05-21 in DX-completion #569) | confirm coverage parity |

Fill the `?` cells by reading the framework source. Don't guess.

### Task 3.3: Categorize gaps

For each gap, classify as:
- 🔴 **High value, low cost** — common pattern, small surface to add.
- 🟡 **Useful, moderate cost** — would help but bigger design lift.
- 🟢 **Defer** — niche or already covered indirectly.

### Task 3.4: Findings report + design sketches

For 🔴 items, include a **design sketch** in the findings doc — API signature, where it lives (`@rudderjs/testing` vs a per-package `testing` subpath), one-paragraph implementation note. The sketches are what the user reviews; they're not commitments.

### Task 3.5: User checkpoint — scope AND version policy

Phase 3's user-question must ask **both**:
- Which gaps to fill (the standard scope question).
- Whether the new APIs ship as `feat:` minor bumps to `@rudderjs/testing` (yes by default), or as a new sub-package.

### Task 3.6: Implement (likely multi-PR)

One PR per coherent helper or small helper-bundle. TDD-mandatory here — these are new APIs; tests come first.

**Step 1:** Branch.
**Step 2:** Write a failing test that exercises the new helper as a user would.
**Step 3:** Implement.
**Step 4:** Pass the test.
**Step 5:** Add a docs section in `docs/guide/testing.md` (don't ship a feature without docs).
**Step 6:** Add an example to `playground/` exercising the helper (so it's exercised by `scripts/client-bundle-smoke.mjs` and the broader test surface).
**Step 7:** `feat:` PR with a `minor` changeset on `@rudderjs/testing` (and any package the helper integrates with, e.g. `@rudderjs/queue` for `expectsJobs`).
**Step 8:** Open PR, await CI + merge auth.

### Task 3.7: Post-flight

Update Status, sync site docs (`docs/guide/testing.md` changed → site sweep), update memory if the testing surface fundamentally changed.

---

## Phase 4 — Public API surface review

**Why now:** Every `export` from a `@rudderjs/*` package is part of the 1.x public API. After two years of evolution, there's almost certainly internal-looking-symbol leakage. Identifying it now is cheap; identifying it after someone depends on a leaked symbol is a breaking change. **High stakes:** removal of any leaked symbol = major bump. The default outcome here is `@internal` JSDoc markers, NOT removals.

### Task 4.1: Extract per-package public exports

**Step 1:** For each package, list the surface visible to consumers:
```bash
for pkg in packages/*/; do
  name=$(node -e "console.log(require('./$pkg/package.json').name)" 2>/dev/null)
  [ -z "$name" ] && continue
  echo "=== $name ==="
  # Read every entry from the package.json `exports` field and grep its TS for `export`
done
```

**Step 2:** For each entry, capture: exported name, kind (function/class/type/value), whether it appears in `docs/guide/*` or `docs/packages/*` (rough "is this documented?" signal), and whether it appears in the package's README.

**Step 3:** Write to `docs/plans/findings/2026-05-28-phase-4-public-api.md` under `## Per-package exports`.

### Task 4.2: Triage each export

Three categories:
- **Intentional public** — documented, used by playground / other packages externally, advertised in CLAUDE.md.
- **Needs `@internal` marker** — exported but only used by the framework itself; remove from public-API contract via JSDoc `@internal` (TypeScript honors this for declaration emit).
- **Likely accidental** — name patterns (`_…`, `internal…`, helper-y names) without docs or external usage.

**Tooling note:** TypeScript has `@internal` JSDoc that, with `stripInternal: true` in `tsconfig`, omits the symbol from `.d.ts`. Verify whether the monorepo's `tsconfig.base.json` already sets `stripInternal`; if not, that's a Phase 4 deliverable.

### Task 4.3: Find unintentional leaks

**Step 1:** For each "likely accidental" candidate, `grep -rn "import.*<name>" packages/ playground/` to see if anything outside the owning package uses it. External use → it's intentional; flag and document it instead.

**Step 2:** For each candidate with zero external use, the recommendation is: add `@internal`, leave the symbol in place (no breaking change today), and queue removal for the next major.

### Task 4.4: Findings report

```markdown
# Phase 4 Findings — Public API surface review
## Per-package exports (per-package tables)
## Intentional public — leave alone
## Needs @internal marker — fix now (no breaking change)
## Likely accidental, in use externally — adopt or rename
## Queue for next major — explicit removal candidates
## Tooling: stripInternal status
## Overall assessment
```

### Task 4.5: User checkpoint — version policy

Phase 4's question is about **policy**, not just scope:
- Apply `@internal` markers + flip `stripInternal: true`? (Recommended — quiet, no break.)
- Aggressively remove any `@internal` symbols from public types in this round? (Likely major bumps — discouraged in 1.x.)
- Queue removals for a future major?

### Task 4.6: Implement

For the recommended path (markers + `stripInternal`):

**Step 1:** Branch.
**Step 2:** Add `@internal` JSDoc to each agreed symbol — purely additive, no behavior change.
**Step 3:** If `stripInternal` isn't set, add it to `tsconfig.base.json`.
**Step 4:** `pnpm build` from root — verify `.d.ts` outputs no longer include `@internal` symbols. Spot-check a couple of `dist/index.d.ts` files.
**Step 5:** Each package whose declaration emit changed gets a `patch` changeset — the public-types contract is shrinking even though runtime is identical, so consumers' TypeScript builds could surface fresh errors. Note this in the changeset description.
**Step 6:** `refactor:` or `chore:` PR (no behavior change) — but with a clear body explaining the declaration-surface shrink.

### Task 4.7: Post-flight

Status, memory, site docs if touched. If `stripInternal` was added, note the new monorepo convention in CLAUDE.md.

---

## When NOT to start a phase

- **Open PR conflict** — if any phase's owning packages have an open PR, finish that first (memory: "Don't touch branches with an open PR").
- **Memory hot** — if memory says an area was recently swept and you can't verify the gap is real in 5 minutes of grep, escalate to the user before investing more. The boost-coverage drift demonstrates the cost of over-trusting memory.
- **Dependency** — Phases are independent; don't artificially serialize. But Phase 3 (testing) likely cross-references Phase 2 (error messages) when designing testable error assertions — sequence those two if natural.

---

## Execution handoff

**Plan complete.** Two execution options:

1. **Subagent-driven (this session)** — I dispatch one investigation agent per phase, review findings between phases, and we run all four end-to-end in one extended session.
2. **Parallel session (separate)** — Open a new session per phase using `superpowers:executing-plans` against this doc, with explicit checkpoint approvals between phases.

Recommended for this plan: **parallel session per phase**. The phases are bounded enough that each fits comfortably in one session, the scope-decision checkpoints are natural session boundaries, and the multi-session state lives in this doc's Status table — survives any session reset.
