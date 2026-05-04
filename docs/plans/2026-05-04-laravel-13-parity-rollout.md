# Laravel 13 Parity Rollout — Meta-Plan

**Status:** PROPOSED 2026-05-04 — execution sequencing for the 8 sibling parity plans.
**Scope:** Coordinates `2026-05-04-cache-atomic-locks.md`, `-orm-dirty-quiet-wherehas.md`, `-orm-aggregate-eager-loading.md`, `-storage-temp-urls-visibility.md`, `-router-laravel-parity.md`, `-formrequest-hooks.md`, `-container-tagging.md`, `-orm-prunable.md`.
**Audience:** the engineer (or set of engineers) executing the parity sweep — not a design doc, a sequencing/risk-mitigation doc.

---

## Why a meta-plan

The 8 sibling plans were written independently and are individually self-contained. But they touch overlapping surfaces:

- 3 of them (`#2 dirty-quiet-wherehas`, `#3 aggregates`, `#8 prunable`) touch `packages/orm/src/index.ts` Model class.
- 2 of them (`#2`, `#3`) widen the `QueryBuilder<T>` contract in `@rudderjs/contracts` and require matching changes in both `orm-prisma` and `orm-drizzle`.
- `#1 cache-locks` rewrites two existing consumers (`WithoutOverlapping` job middleware, `schedule.onOneServer`) — those refactors must land in the same PR as the lock API or both stay racy.
- An active `orm-morph` worktree at `~/Projects/rudder-orm-morph` already has a `prunable` commit on its HEAD — `#8` may overlap with in-progress work.

This doc fixes the order, calls out the conflicts, and gives a per-plan workflow.

---

## ⚠ Pre-flight check (before any plan starts)

**Resolve `orm-morph` worktree first.** `git worktree list` shows:

```
/Users/sleman/Projects/rudder-orm-morph  b06473bb [orm-morph] prunable
```

The HEAD commit message is literally `prunable`. Either:

1. **Fold existing work into #8** — switch into the worktree, read the diff, update `2026-05-04-orm-prunable.md` to mark already-done tasks, then continue from where it stopped.
2. **Land the in-flight branch first** — if it's a complete prunable implementation, ship it as the prunable PR and close `#8` as already-done.
3. **Discard if abandoned** — if the work is stale and superseded by `#8`'s plan, kill the worktree (`git worktree remove`) and proceed from scratch.

**Don't start `#8` blind.** Per memory feedback `feedback_check_worktrees_before_big_work.md`, sibling worktrees can hold completed work that `git log` won't show because nothing is committed past HEAD.

---

## Dependency / conflict map

| Plan | Package(s) touched | Adapter changes | Conflicts with |
|---|---|---|---|
| #1 cache-atomic-locks | `cache`, `queue`, `schedule` | — | none |
| #2 orm-dirty-quiet-wherehas | `orm`, `contracts`, `orm-prisma`, `orm-drizzle` | yes (whereRelationExists) | #3, #8 (Model.ts) |
| #3 orm-aggregate-eager-loading | `orm`, `contracts`, `orm-prisma`, `orm-drizzle` | yes (aggregate state) | #2 (contracts), #8 |
| #4 storage-temp-urls-visibility | `storage` (+ optional `router` peer) | — | none |
| #5 router-laravel-parity | `router`, `server-hono`, `cli`, `contracts` | minor (RouteDefinition) | none |
| #6 formrequest-hooks | `core` (validation.ts only) | — | none |
| #7 container-tagging | `core` (container.ts only) | — | none |
| #8 orm-prunable | `orm`, `cli`, `console` | — | #2, #3 (Model.ts), **orm-morph worktree** |

**Independent set** (parallel-safe): #1, #4, #5, #6, #7
**ORM serial chain:** #2 → #3 → #8

---

## Execution waves

### Wave 1 — kick off in parallel (4 worktrees)

Independent, low-risk, ship as separate PRs as each finishes. Expected lead times in parens.

| Plan | Effort | Worktree branch | First win |
|---|---|---|---|
| #6 formrequest-hooks | S (1-2d) | `core/formrequest-hooks` | Smallest plan; warm-up for the workflow |
| #7 container-tagging | S-M (2-3d) | `core/container-tagging` | Unblocks future `#[Auth]`/`#[Cache]` attribute injectors |
| #1 cache-atomic-locks | M (2-4d) | `cache/atomic-locks` | Fixes 2 latent race bugs (WithoutOverlapping + onOneServer) |
| #5 router-laravel-parity | M-L (3-5d) | `router/laravel-parity` | Most user-visible polish |

**PR strategy for #5 specifically** — split into 3 reviewable chunks rather than one big PR:
1. PR1: 6 constraint shortcuts (`whereNumber`/`whereUuid`/etc.) + `where()` base
2. PR2: `router.group()` + subdomain + host extraction in server-hono
3. PR3: `Route::resource`/`apiResource`/`singleton` + `make:controller --resource`

**PR strategy for #7 specifically** — split into 2:
1. PR1: `tag`/`tagged` + `bindIf`/`singletonIf`/`scopedIf`
2. PR2: `extend` + `rebinding` + `@Tag` decorator

### Wave 2 — start anytime in parallel with Wave 1

| Plan | Effort | Worktree branch | Notes |
|---|---|---|---|
| #4 storage-temp-urls-visibility | L (4-6d) | `storage/temp-urls-visibility` | Adds `@aws-sdk/s3-request-presigner` + `@aws-sdk/lib-storage` as optional deps; write `FakeAdapter` first — everything else becomes testable through it |

### Wave 3 — ORM serial chain (one at a time, in order)

These three **cannot** run in parallel — they all touch `packages/orm/src/index.ts` Model class and `@rudderjs/contracts`'s `QueryBuilder<T>` interface. Doing them in parallel = guaranteed merge conflicts on every PR rebase.

| Order | Plan | Effort | Branch | Why this order |
|---|---|---|---|---|
| 1st | #2 orm-dirty-quiet-wherehas | L (5-7d) | `orm/dirty-quiet-wherehas` | Most invasive contract changes; lands first so others rebase onto stable contract |
| 2nd | #3 orm-aggregate-eager-loading | L (5-7d) | `orm/aggregate-eager-loading` | Builds on the same contract surface; needs `#2`'s `whereRelationExists` plumbing as precedent |
| 3rd | #8 orm-prunable | S (1-2d) | `orm/prunable` (or `orm-morph` if folded in) | Just hooks into `ModelRegistry`; tiny once the bigger pieces are in |

---

## Suggested calendar (solo execution)

If one person is driving this end-to-end:

```
Week 1:  #6 → #7 (PR1 + PR2)         3 small/medium PRs, build momentum
Week 2:  #1 → #5 (PR1 + PR2 + PR3)   4 PRs, all infrastructure wins
Week 3:  #4                           Storage in isolation, deeper feature
Week 4:  #2                           First ORM PR
Week 5:  #3                           Aggregates
Week 6:  #8                           Prunable (or earlier if orm-morph folded in)
```

~6 weeks, ~12 PRs total. The highest-leverage pieces (cache locks, container tag, router shortcuts, FormRequest hooks) ship in the first two weeks.

If multiple engineers split the work, Wave 1 + Wave 2 can run fully in parallel — collapse to ~3 weeks total.

---

## Per-plan workflow (mandatory cycle)

For each PR, walk this exact sequence:

```
1. using-git-worktrees       → create worktree from main, isolated dist/
2. test-driven-development   → failing tests for new API first
3. executing-plans           → step through the numbered plan tasks
4. verification-before-completion → pnpm typecheck + pnpm test + playground smoke
5. requesting-code-review    → /ultrareview before opening PR
6. finishing-a-development-branch → open PR, wait for green CI
```

Each plan doc breaks features into numbered tasks — `executing-plans` walks that spine.

**Hard gates before opening PR:**

- `pnpm build` from root succeeds
- `pnpm typecheck` from root succeeds
- `pnpm test` for affected packages succeeds
- For `#1`/`#5`: `cd playground && pnpm dev` boots cleanly
- For `#2`/`#3`/`#8`: `cd playground && pnpm rudder` shows updated commands; existing playground demos still work
- For `#4`: storage demo at `/demos/storage` (if exists, else create one) exercises the new APIs
- For `#6`: a new playground FormRequest exercises each hook

---

## Cross-cutting concerns

### CHANGELOGs and Changesets

Every PR needs a changeset:

```bash
pnpm changeset
```

For the parity sweep, **minor** version bump per package — these are additive features. **No** patch bumps; users care about discoverability.

Bundle sibling-package bumps in the same changeset when they ship together (e.g. `#2` bumps `orm`, `contracts`, `orm-prisma`, `orm-drizzle` all minor in the same changeset).

### Documentation

After each PR merges to main:

1. Update the framework docs in `docs/guide/<feature>.md` (or create the page).
2. Update `docs/api/<package>.md` reference if it exists.
3. Sync to rudderjs-com repo per memory `project_rudderjs_com_docs_sync.md` (4-step sweep).
4. Update `claude-notes/packages.md` if the package's one-line description changed.
5. Update `boost/guidelines.md` in the affected package — and grep for fictional API per memory `feedback_boost_guidelines_fictional_api.md`.
6. Update `CLAUDE.md` "Common Pitfalls" section if the new feature has gotchas.

### Auto-discovery + scaffolder

- **#1 cache-locks**: no scaffolder change (cache is a default provider).
- **#5 router**: if `make:controller --resource` is added, register the new flag in `packages/cli/src/commands/make/controller.ts`.
- **#8 orm-prunable**: register the `model:prune` command in `packages/cli/src/index.ts`'s `loadPackageCommands()` per CLAUDE.md note.

### Telescope collectors

- **#1 cache-locks**: extend the existing cache collector to record lock acquire/release events.
- **#2 ORM whereHas**: should appear in query collector automatically (no change needed).
- **#3 ORM aggregates**: same — query collector picks them up.

If telescope panels need new sub-types, add them in the same PR; otherwise file as follow-up.

---

## Risk register

| Risk | Mitigation |
|---|---|
| `orm-morph` already has prunable work | Pre-flight check above. Do not start #8 until reconciled. |
| `#2` + `#3` + `#8` merge conflicts | Strict serialization, rebase each on previous merge before opening PR. |
| Drizzle adapter feature-parity drift | Both `#2` and `#3` mandate Drizzle implementation, not just Prisma. Don't ship one-adapter-only. |
| Optional-peer load failures (S3 presigner, etc.) | Test in `rudder-web-playground` (WebContainer) for each PR per `feedback_no_top_level_node_imports`. |
| Boost guidelines.md drift after API additions | Re-run `boost:update` from playground after each PR; cross-check against actual `src/index.ts` exports per `feedback_boost_guidelines_fictional_api.md`. |
| Pre-existing in-flight branches reappear | Already deleted in this branch's cleanup. Re-check `git branch -a` before each new worktree. |

---

## Out of scope for this rollout

- Documentation site overhaul (handled per-feature, not as a sweep)
- Migration guides for existing users (additive features → no migration)
- Performance benchmarking (acceptance criteria are correctness + parity, not throughput)
- Other Laravel 13 gaps not in the 8 plans:
  - Scout (search)
  - Cashier-Stripe
  - Dusk (browser tests)
  - Precognition
  - Envoy
  - MongoDB ORM driver
  - Validation rule expansion (date/file/db rules — Zod-shape work, separate effort)
  - Container attribute injectors (`#[Auth]`/`#[Cache]`/etc. — needs `#7` to land first, then a separate plan)
  - Notification channels (SMS/Slack/Vonage)
  - Mail tags + metadata + HasLocalePreference

These should each get their own plan when prioritized.

---

## Done definition for the rollout

- All 8 sibling plans have at least one merged PR per their primary feature.
- Every affected package has a published 1.x minor version on npm via Changesets.
- `claude-notes/packages.md` reflects the new capabilities.
- `CLAUDE.md` Common Pitfalls section updated with any new gotchas surfaced during implementation.
- A new playground demo exists for any user-visible new feature (router resource, formrequest hooks, cache locks, storage temporaryUrl, container tagging).
- This meta-plan + the 8 sibling plans get archived (deleted from `docs/plans/`) once everything ships.
