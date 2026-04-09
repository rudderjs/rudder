# Pilotic Extraction Plan

Extract `packages/panels` and `packages/panels-lexical` out of the `rudderjs/rudder` monorepo into a brand-new `pilotic/pilotic` monorepo under the `@pilotic/*` npm scope, then carve out two private pro packages (`@pilotic-pro/ai`, `@pilotic-pro/collab`) into a sibling `pilotic/pilotic-pro` repo. Result: RudderJS becomes a focused Laravel-style framework, Pilotic becomes a standalone admin/CMS product with an open core and a paid pro tier.

**Status:** DRAFT 2026-04-09.

**Packages affected:**
- Removed from `rudderjs/rudder`: `@rudderjs/panels`, `@rudderjs/panels-lexical`
- New in `pilotic/pilotic` (public, MIT): `@pilotic/panels`, `@pilotic/lexical`
- New in `pilotic/pilotic-pro` (private, commercial): `@pilotic-pro/ai`, `@pilotic-pro/collab`

**Depends on:** none — foundational restructuring.

**Related memory:** `project_pilotic_rebrand.md`, `reference_panels_ai_surfaces.md`, `feedback_yjs_idb_ws_order.md`, `feedback_panels_pages_parallel_copy.md`, `feedback_panels_dist_rebuild.md`

---

## Goal

After this plan:

1. `rudderjs/rudder` contains no panel/admin/CMS code. The framework is exclusively the Laravel-style runtime: core, router, orm, auth, cache, queue, mail, etc.
2. `pilotic/pilotic` is a standalone public monorepo containing `@pilotic/panels` and `@pilotic/lexical`, each depending on the relevant `@rudderjs/*` packages via pinned npm versions.
3. The public consumer API is unchanged at the call site:
   ```ts
   import { Panel } from '@pilotic/panels'
   export const adminPanel = Panel.make('admin').path('/admin')...
   ```
4. `pilotic/pilotic-pro` is a private monorepo with `@pilotic-pro/ai` (PanelAgent + chat + tools + chat UI) and `@pilotic-pro/collab` (Yjs persistence + presence). Both register via `panel.use(...)` plugin hooks exposed by `@pilotic/panels`.
5. `@rudderjs/panels` and `@rudderjs/panels-lexical` exist on npm only as deprecation stubs pointing at the new names.
6. Brand surface: `pilotic.io` is live (placeholder OK), the `pilotic` GitHub org hosts both repos, the README leads with the product story.
7. A documented cross-repo dev workflow lets you iterate on `@rudderjs/core` and `@pilotic/panels` simultaneously without npm publishes.

---

## Non-Goals

- **Cloud (managed Pilotic).** Out of scope for this plan; covered in a future `pilotic-cloud-plan.md` once pro packages are shipping.
- **Marketing site at `pilotic.io`.** A placeholder landing page is acceptable; the polished site is its own effort.
- **Renaming the `Panel` class or any other public API symbol.** Only package names and import paths change.
- **Splitting `@pilotic/panels` into smaller packages** (`@pilotic/media`, `@pilotic/blocks`, `@pilotic/cli`). Leave as one package for now; split later only if there's real coupling pain.
- **Preserving git history.** Clean cut — `git blame` on the new repo starts at the extraction commit. Decision rationale: history is preserved in `rudderjs/rudder` forever, the new repo's blame fresh-start is acceptable for solo dev.
- **Backporting fixes to `@rudderjs/panels`.** Once deprecated, no patches. Users must migrate to `@pilotic/panels`.
- **License keys with phone-home or DRM.** Phase 6 ships a light JWT signature check only; no usage metering, no online verification.
- **Multi-level pro package gating.** Each pro package decides its own license check; no shared license server.

---

## Background

### Current state (2026-04-09)

`rudderjs/rudder` is a 47-package monorepo. Two packages are panel-specific:

- **`packages/panels`** (`@rudderjs/panels` v0.0.3) — the Filament-style admin runtime. Hard-deps on `@rudderjs/core`, `@rudderjs/router`, `@rudderjs/support`. Optional peers on `@rudderjs/ai`, `@rudderjs/cache`, `@rudderjs/storage`, `@rudderjs/image`, `@rudderjs/broadcast`, `@rudderjs/live`, `@rudderjs/localization`. The optional-peer pattern means the package is already designed to gracefully degrade without AI / collab / etc.
- **`packages/panels-lexical`** — Lexical editor integration, including the Yjs collaboration wiring (per `feedback_yjs_idb_ws_order.md`, `useYjsCollab.ts` lives here).

The AI surface inside `@rudderjs/panels` is already cleanly localized:
- `src/handlers/chat/**` (21 files): chat handler, continuation, conversation manager, contexts, tools (`updateFormStateTool`, `readFormStateTool`, `editTextTool`, `runAgentTool`, etc.), sub-agent resume, persistence
- `src/agents/**` (2 files): `PanelAgent`, agent types
- `pages/_components/agents/**`: chat UI components (vendored to `playground/pages/(panels)/_components/agents/**` via `pnpm rudder vendor:publish --tag=panels-pages`)

The collab surface lives in `packages/panels-lexical` and is similarly contained — it's the Yjs binding plus a server-side persistence handler.

### Why split repos rather than stay in monorepo

Earlier in the planning conversation we considered keeping panels inside the rudderjs monorepo and only renaming. Reversed because:

1. **Framework is now stable** — the precondition for a clean split. No more weekly framework churn driven by panels.
2. **Brand clarity** — two repos = two stories = two npm scopes. Removes the persistent "is panels part of the framework?" confusion.
3. **Pro repo fits naturally** — `pilotic/pilotic-pro` as a private sibling is cleaner than wedging `@rudderjs-pro/*` into a framework that has nothing to do with the product.
4. **Contributor narrowing** — someone fixing a Lexical block doesn't need to clone 47 framework packages.
5. **Forces framework API stability** — pinned npm version coupling is a feature, not a cost.

The cost — cross-repo dev loop — is mitigated by `pnpm overrides` pointing at a local clone (Phase 1.5).

### Locked decisions (from planning conversation)

- npm scope: `@pilotic` (owned)
- GitHub: `pilotic` org (owned), repos `pilotic/pilotic` (public) + `pilotic/pilotic-pro` (private)
- Domain: `pilotic.io` primary, `pilotic.dev` and `pilotic.store` secondary
- Public API: `Panel.make('admin')...` unchanged; only the import path moves
- Free packages: `@pilotic/panels`, `@pilotic/lexical`
- Pro packages: `@pilotic-pro/ai` (PanelAgent + chat + tools + UI), `@pilotic-pro/collab` (Yjs + presence + persistence)
- History: clean cut, no `git filter-repo`
- Plan doc: drafted here in `rudderjs/rudder/docs/plans/`, copied to `pilotic/pilotic/docs/plans/` at Phase 1

---

## Phase 0 — Audit (no code moves)

**Goal:** Produce a complete file-level map of what extracts where, so Phases 2–5 are mechanical, not investigative.

**Steps:**

1. Walk `packages/panels/src/**` and tag each file as one of: `core` | `ai` | `lexical-bridge` | `media` | `theme` | `tests`.
2. Walk `packages/panels-lexical/src/**` and tag each file as: `lexical-core` | `collab` | `tests`.
3. For every file tagged `ai` or `collab`, record its inbound imports — verify nothing in `core` imports from it.
4. Map the chat UI: confirm `pages/_components/agents/**` is authored in `packages/panels/pages` and only mirrored to `playground` via `vendor:publish`. Record the mirror tag (`panels-pages`).
5. Confirm `panels-lexical` import direction: does it depend on `panels`, or vice versa, or neither? Update the dep graph in this doc.
6. Grep the entire monorepo for `@rudderjs/panels` and `@rudderjs/panels-lexical` to enumerate every consumer (playground, docs, other packages, scripts).
7. Run `pnpm build` and `pnpm test` for both panels packages to capture a known-green baseline.
8. Append the audit findings to this plan doc (new section: `## Audit Results`).

**Done when:** the audit section in this doc lists every file's destination package and every consumer's required import update.

**Risks:** discovering a deep import from `core` → `chat` or `core` → `collab` that breaks the optional-peer assumption. Mitigation: if found, file a one-PR refactor in `rudderjs/rudder` to invert the dependency *before* extraction.

---

## Phase 1 — Bootstrap `pilotic/pilotic` repo

**Goal:** Empty but production-ready monorepo at `pilotic/pilotic` with tooling, CI, README, and a copy of this plan. No code extracted yet.

**Steps:**

1. Create `pilotic/pilotic` GitHub repo (public, MIT license).
2. Initialize as a pnpm + Turborepo monorepo matching `rudderjs/rudder`'s setup:
   - `pnpm-workspace.yaml`, `turbo.json`, root `package.json`, `tsconfig.base.json`
   - `.changeset/` configured for `@pilotic/*` scope
   - GitHub Actions: build + typecheck + test on PR
   - `.gitignore`, `.npmrc` (`access=public`)
3. Copy `docs/plans/pilotic-extraction-plan.md` (this file) into `pilotic/pilotic/docs/plans/`.
4. Write the README — lead with positioning: "Pilotic — the open-source admin and CMS for RudderJS, with a built-in agent." Link to `pilotic.io`, GitHub, RudderJS framework.
5. Reserve `@pilotic/panels` and `@pilotic/lexical` on npm (publish empty `0.0.0` placeholder packages with `private: false` and a `README.md` saying "extraction in progress").
6. Stand up `pilotic.io` placeholder page (single-page "coming soon" + GitHub link is fine).
7. Configure `pnpm` in the new repo to consume `@rudderjs/*` from npm (not workspace).

**Done when:** `git clone pilotic/pilotic && pnpm install && pnpm build` succeeds on an empty workspace; `npm view @pilotic/panels` returns the placeholder.

**Risks:** none meaningful. This is plumbing.

---

## Phase 1.5 — Cross-repo dev workflow

**Goal:** Document and verify the workflow for iterating on `@rudderjs/*` and `@pilotic/*` simultaneously without npm publishes.

**Steps:**

1. In `pilotic/pilotic/package.json`, document a `pnpm.overrides` recipe (commented out) pointing each `@rudderjs/*` dep at `link:../rudder/packages/<name>`. Users uncomment when active framework dev is needed.
2. Document the alternative: `pnpm link --global` per package.
3. Add a `docs/development.md` to `pilotic/pilotic` explaining the workflow.
4. Smoke test it: with overrides active, make a trivial change in `rudderjs/rudder/packages/core`, rebuild, verify `@pilotic/panels` picks it up.

**Done when:** the dev loop is documented, smoke-tested, and reproducible from a clean clone.

**Risks:** `exactOptionalPropertyTypes` and other tsconfig strictness can cause linked deps to fail typechecking when they pass in their own repo. Mitigation: align `tsconfig.base.json` between the two repos; flagged in `feedback_exactoptional.md`.

---

## Phase 2 — Extract `@pilotic/panels` and `@pilotic/lexical`

**Goal:** Move all panels code out of `rudderjs/rudder` into `pilotic/pilotic`, rename the packages, update every consumer, ship `0.1.0` of both new packages.

**Steps:**

1. **Copy** (not git-mv, since we're crossing repos with no history) the contents of `rudderjs/rudder/packages/panels/` into `pilotic/pilotic/packages/panels/`.
2. Same for `panels-lexical/` → `pilotic/pilotic/packages/lexical/`.
3. Rewrite both `package.json` files:
   - `name`: `@pilotic/panels`, `@pilotic/lexical`
   - `version`: `0.1.0`
   - `repository.url`: `https://github.com/pilotic/pilotic`
   - `repository.directory`: `packages/panels` / `packages/lexical`
   - Convert `@rudderjs/*` workspace deps to pinned npm versions matching the latest published `rudderjs/rudder` release
   - If `@pilotic/lexical` depends on `@pilotic/panels` (TBD in audit), use `workspace:*`
4. Find/replace `@rudderjs/panels` → `@pilotic/panels` and `@rudderjs/panels-lexical` → `@pilotic/lexical` across the new repo (source, configs, docs, tests).
5. Update all internal documentation in the new repo (README, CLAUDE.md if any, docs/).
6. `pnpm build && pnpm typecheck && pnpm test` — must pass green in the new repo before proceeding.
7. **In `rudderjs/rudder`**:
   - `git rm -r packages/panels packages/panels-lexical`
   - Update `playground/` to depend on `@pilotic/panels` and `@pilotic/lexical` from npm (not workspace)
   - Update `playground/bootstrap/providers.ts`, page imports, vendor:publish tag (`panels-pages` → `pilotic-pages`)
   - Update `CLAUDE.md`: remove panels references, link to `pilotic/pilotic` for panel docs
   - Rename `docs/claude/panels.md` → delete (lives in pilotic repo now)
   - Run `pnpm build && pnpm typecheck` from root — must pass green
8. **Publish**:
   - `@pilotic/panels@0.1.0` and `@pilotic/lexical@0.1.0` from `pilotic/pilotic`
   - Final `@rudderjs/panels@<next>` from `rudderjs/rudder` containing only a README pointing at `@pilotic/panels`; mark `deprecated` via `npm deprecate`
   - Same for `@rudderjs/panels-lexical`
9. Update memory:
   - `feedback_panels_pages_parallel_copy.md` — point at `@pilotic/panels` paths
   - `feedback_panels_dist_rebuild.md` — same
   - `feedback_yjs_idb_ws_order.md` — same
   - `reference_panels_ai_surfaces.md` — rename to `reference_pilotic_ai_surfaces.md`
   - Add `reference_pilotic_repo.md` pointing at the new repo's README + dev docs

**Done when:**
- `rudderjs/rudder` has zero references to panels in `git grep`
- `playground` runs against `@pilotic/panels` from npm
- `npm view @rudderjs/panels` shows deprecation
- `npm view @pilotic/panels` shows `0.1.0`

**Risks:**
- **`vendor:publish` mirror desync.** The `panels-pages` → `pilotic-pages` rename has to happen atomically with the package rename or the playground breaks. Mitigation: do both in the same commit.
- **Pinned npm version drift.** `@pilotic/panels` will pin `@rudderjs/core@x.y.z`. If you bump `@rudderjs/core` later, `@pilotic/panels` needs an explicit bump. Mitigation: documented in `pilotic/pilotic/docs/development.md`.
- **Optional peer deps that aren't installed in `pilotic/pilotic` will trip CI typecheck.** Mitigation: add them as devDependencies in `pilotic/pilotic` for testing, mirror the existing `panels` setup.
- **Production build pitfalls** (`feedback_production_build.md`) — node:crypto lazy-load, vite externals — must carry over to the new repo's vite config and test against the playground.

---

## Phase 3 — Define extension hooks for AI and collab

**Goal:** Before extracting AI or collab, harden the `panel.use(...)` plugin contract so pro packages can register without forking `@pilotic/panels`.

**Steps:**

1. **AI hook**: `@pilotic/panels` exports a stable `PanelAiPlugin` interface with registration points for:
   - chat handler (`registerChatHandler(panel, handler)`)
   - default panel agent (`registerPanelAgent(panel, AgentClass)`)
   - chat UI mount point (the panel renders a slot; the AI plugin fills it)
   - client tool registry (`registerClientTool(panel, name, executor)`)
   The `PanelAgent` *base class* moves to `@pilotic/panels` (it's primitive); the *chat runtime* and the *5 default tools* move to `@pilotic-pro/ai`.
2. **Collab hook**: `@pilotic/lexical` exports a `LexicalCollabPlugin` interface with:
   - Yjs binding factory (`createYjsBinding(doc, awareness)`)
   - persistence adapter (`registerPersistence(adapter)`)
   - presence renderer slot
   The free `@pilotic/lexical` ships an editor in **local-only mode** (saves on form submit, no real-time sync). The pro plugin injects collab.
3. Refactor existing chat / collab code in `@pilotic/panels` and `@pilotic/lexical` to consume these hooks internally — i.e., the current monolithic wiring becomes "the panel uses its own AI plugin from inside the same package." This validates the contract without breaking anything.
4. Add a `docs/plugins.md` to `pilotic/pilotic` documenting the contracts.
5. Ship `@pilotic/panels@0.2.0` and `@pilotic/lexical@0.2.0`.

**Done when:**
- The `PanelAiPlugin` and `LexicalCollabPlugin` types are exported and documented
- The existing in-package AI and collab code consumes the same hooks the future pro packages will use
- `playground` still works identically — no behavior change, just internal restructuring

**Risks:**
- **Hook design that's too narrow.** If the chat handler hook can't express something the current `chatHandler.ts` does, the pro extraction will need to expand the contract later. Mitigation: refactor `chatHandler.ts` to *be* the canonical hook implementation, so any feature it has is by definition expressible.
- **`PanelAgent` base class pulled to free package may pull AI deps with it.** Mitigation: the base class should be a pure interface + minimal state, no `@rudderjs/ai` import. The runtime that uses it lives in pro.

---

## Phase 4 — Extract `@pilotic-pro/ai`

**Goal:** Move the AI runtime out of `@pilotic/panels` into the private `@pilotic-pro/ai` package.

**Steps:**

1. Create `pilotic/pilotic-pro` private GitHub repo, mirror the monorepo tooling from `pilotic/pilotic`.
2. Configure `.npmrc` for private package publishing (npm or self-hosted Verdaccio — decide here).
3. Copy these files from `pilotic/pilotic/packages/panels/` into `pilotic/pilotic-pro/packages/ai/`:
   - `src/handlers/chat/**` (21 files)
   - `src/agents/PanelAgent.ts` runtime (the base class stays in `@pilotic/panels` per Phase 3; only the runtime moves)
   - `pages/_components/agents/**` chat UI components
4. Create `@pilotic-pro/ai` package.json depending on `@pilotic/panels`, `@rudderjs/ai`, `@rudderjs/cache` (for runStore TTL).
5. Implement `pilotAi(opts)` plugin entry point that registers everything via the Phase 3 hooks:
   ```ts
   import { piloticAi } from '@pilotic-pro/ai'
   panel.use(piloticAi({ defaultAgent: MyAgent }))
   ```
6. **Decision: which 5 default tools stay free vs. move to pro?**
   - Free (in `@pilotic/panels` as plain server actions, not as AI tools): `update_field`, `read_record`. They're useful without AI.
   - Pro (in `@pilotic-pro/ai`): `edit_text`, `update_form_state`, `read_form_state`, all chat-mode prompt logic, the dispatcher.
7. Delete the moved files from `pilotic/pilotic/packages/panels/`.
8. Ship `@pilotic-pro/ai@0.1.0`.
9. Bump `@pilotic/panels@0.3.0` (no AI runtime).
10. Update `playground` to install `@pilotic-pro/ai` and call `panel.use(piloticAi(...))`.
11. Smoke test against the playground's `slow_search` agent and `improve-content` sub-agent (per `reference_playground_smoke_tests.md`).
12. Update memory: `bug_subagent_client_tools.md`, `feedback_chat_selection_mode_prompt.md`, `feedback_authoring_streaming_tools.md` — repath to `@pilotic-pro/ai`.

**Done when:**
- `@pilotic/panels` has zero `chat/` or AI runtime code
- `@pilotic-pro/ai` ships and the playground's chat + agent flows work identically
- All AI memory notes point at the new package

**Risks:**
- **Vendor:publish for `pages/_components/agents`** now needs to publish from a *different* package (`@pilotic-pro/ai`). The `pnpm rudder vendor:publish` flow may need to support multi-source tags.
- **Free users will lose the chat UI entirely.** Verify the panel renders cleanly without the AI plugin loaded — no broken slots, no missing icons.
- **`@rudderjs/ai` peer dep** must be present at runtime when `@pilotic-pro/ai` is installed. Document.

---

## Phase 5 — Extract `@pilotic-pro/collab`

**Goal:** Move Yjs persistence + presence out of `@pilotic/lexical` into `@pilotic-pro/collab`.

**Steps:**

1. Identify the collab files in `@pilotic/lexical` (Phase 0 audit pinned this).
2. Copy them into `pilotic/pilotic-pro/packages/collab/`.
3. Create `@pilotic-pro/collab` package.json depending on `@pilotic/lexical`, `yjs`, `y-prosemirror` or whichever bindings are in use, optionally `@rudderjs/broadcast` for the WS provider.
4. Implement `piloticCollab(opts)` plugin entry point:
   ```ts
   import { piloticCollab } from '@pilotic-pro/collab'
   panel.use(piloticCollab({ provider: 'hocuspocus', persistence: prisma }))
   ```
5. Delete the moved files from `@pilotic/lexical`.
6. Verify free `@pilotic/lexical` editor works in local-only mode (saves on form submit, no Yjs).
7. Ship `@pilotic-pro/collab@0.1.0` and `@pilotic/lexical@0.3.0`.
8. Update `playground` to install `@pilotic-pro/collab`.
9. Smoke test multi-user editing.
10. Carry the `feedback_yjs_idb_ws_order.md` quirk into the new package and update the memory note's file path.

**Done when:**
- `@pilotic/lexical` has zero Yjs code
- Two browser tabs editing the same record see live updates
- Memory notes repathed

**Risks:**
- **`useYjsCollab.ts` load-order quirk** (per memory). Don't fix it during the move; just carry it. Fixing it is a separate plan.
- **Persistence handler** — if it lives in panels (not lexical), the move is cross-package and needs the AI handler-extension hook from Phase 3 to register cleanly.

---

## Phase 6 — License gate

**Goal:** Light JWT-based entitlement check for both pro packages. Logs a warning and degrades gracefully on invalid/missing keys; never crashes.

**Steps:**

1. Generate an Ed25519 keypair. Public key bundled in both pro packages, private key stored in 1Password.
2. Define license JWT claims: `customer_id`, `seats`, `expires`, `plan` (`'team' | 'business'`), `pkg` (`'ai' | 'collab' | 'all'`).
3. On `panel.use(piloticAi(...))` and `panel.use(piloticCollab(...))`, read `PILOTIC_LICENSE_KEY` from env, verify signature, check `expires`, check `pkg` matches.
4. On invalid: `console.warn('[pilotic-pro] license invalid: <reason> — running in unlicensed mode')`. Plugin still loads. No feature gating yet.
5. Add a CLI command in `@pilotic/panels` (or a new `@pilotic/cli` if scaffolding exists): `pilotic license` to show current license status.
6. Document the license format and how to request a key (`docs/licensing.md` in `pilotic/pilotic-pro`'s public-facing README — but the source is private).

**Done when:**
- A valid JWT in `PILOTIC_LICENSE_KEY` boots silently
- An invalid/missing JWT logs the warning and continues
- `pilotic license` shows the expected output

**Risks:**
- **Solo-dev license signing operations.** Keep it manual at this stage — no need for a license server. When you have >10 customers, build a small signing dashboard.
- **Clock skew** on `expires` — accept ±5 minutes.

---

## Phase 7 — Cloud (deferred, separate plan)

Out of scope here. Earmark only: hosted Pilotic = managed Postgres + managed hocuspocus + AI credits + auth/SSO + per-seat billing. Build the cloud plan only after `@pilotic-pro/ai` and `@pilotic-pro/collab` are shipping to at least a few private customers. Until then, all energy goes into Phases 0–6.

---

## Cross-cutting concerns

### Documentation update workflow

Per `feedback_docs_update.md`, update README + docs + CLAUDE.md *during* each phase, not at the end. Each phase's "Done when" includes doc updates as a hard requirement.

### Memory updates required during execution

Phases 2, 4, 5 each end with explicit memory-update steps. Don't defer them — stale memory notes pointing at deleted paths cause future-Claude to grep dead trees.

### Build pitfalls to carry across

- `feedback_production_build.md` — node:crypto lazy-load, vite externals — applies to both new repos
- `feedback_panels_dist_rebuild.md` — `pnpm dev` only HMRs the frontend; server handlers need full rebuild + restart. Same in `@pilotic/panels`.
- `feedback_panels_pages_parallel_copy.md` — `vendor:publish --force` after every `pages/` edit. Tag rename is part of Phase 2.
- `feedback_turbo_cache_dist_stale.md` — Turbo cache can hide stale dist files. Same workaround in new repos.
- `feedback_exactoptional.md` — strict optional types must match between framework and pilotic for cross-repo `pnpm.overrides` to typecheck.

### Things that explicitly stay in `rudderjs/rudder`

- All `@rudderjs/*` packages except `panels` and `panels-lexical`
- `playground/` (now consumes `@pilotic/panels` from npm)
- Framework-level docs (`docs/claude/packages.md`, `docs/claude/create-app.md`, etc.)
- Plans for framework features: `monitoring-plan.md`, `auto-provider-discovery.md`, etc.

### Things that move

- `packages/panels/` → `pilotic/pilotic/packages/panels/`
- `packages/panels-lexical/` → `pilotic/pilotic/packages/lexical/`
- `docs/claude/panels.md` → `pilotic/pilotic/docs/`
- `docs/plans/panels-*.md` and any plan doc that's panels-specific → `pilotic/pilotic/docs/plans/`
- This plan file → also copied to `pilotic/pilotic/docs/plans/pilotic-extraction-plan.md` at Phase 1

### Things that need decisions during execution

- **Private npm registry choice** (Phase 4): npm Pro org private packages vs. self-hosted Verdaccio. Recommendation: npm Pro — zero ops.
- **Multi-source `vendor:publish` support** (Phase 4): the rudder CLI's `vendor:publish` may need extending to handle a tag whose source is in a different package than the original `@pilotic/panels`. Could be a small `@rudderjs/cli` PR.
- **`@pilotic/cli` scaffolder** — a future package, not in this plan, but worth bookmarking. It would replace `pnpm create rudderjs-app` for Pilotic-flavored starts.

---

## Risks (overall)

1. **Cross-repo dev friction.** Mitigation: Phase 1.5 documents and verifies the workflow before any extraction. If overrides prove painful, fall back to publishing canary versions.
2. **Dependency version drift between framework and Pilotic.** Mitigation: pinned versions + deliberate bumps + a `pilotic-framework-bump.md` checklist.
3. **Extraction misses an import.** Mitigation: Phase 0 audit + mandatory green CI on both repos before publishing.
4. **Pro packages leak free-only code or vice versa.** Mitigation: Phase 3 hooks are the only contract; CI in `pilotic/pilotic-pro` should fail if `@pilotic-pro/*` imports anything outside the published `@pilotic/*` API.
5. **Memory/note rot.** Mitigation: explicit per-phase memory update steps with file path lists.
6. **Solo-dev burnout.** Mitigation: each phase is independently shippable. Stop after Phase 2 if needed — even just the rebrand + extraction (without pro packages) is a meaningful release.
7. **Brand confusion during transition.** Mitigation: deprecation messages on `@rudderjs/panels` are explicit; `pilotic.io` placeholder live before Phase 2 publishes.

---

## Phase ordering and stop points

| Order | Phase | Effort | Independently shippable? |
|---|---|---|---|
| 1 | Phase 0 — audit | small | n/a |
| 2 | Phase 1 — bootstrap repo | small | yes (just an empty repo) |
| 3 | Phase 1.5 — dev workflow | small | yes |
| 4 | Phase 2 — extract panels + lexical | medium | **yes — full rebrand done** |
| 5 | Phase 3 — extension hooks | medium | yes |
| 6 | Phase 4 — extract pro AI | large | **yes — first revenue surface** |
| 7 | Phase 5 — extract pro collab | medium | yes |
| 8 | Phase 6 — license gate | small | yes |
| 9 | Phase 7 — cloud | huge | separate plan |

**Natural stop points:**
- After Phase 2: Pilotic exists as a standalone OSS product. Rebrand complete.
- After Phase 4: First pro package shipping. Revenue possible.
- After Phase 6: Open core fully realized with paid tier. Cloud is the next leap.

---

## Audit Results (Phase 0 — completed 2026-04-09)

### Baseline

| Package | Source files (excl. tests) | Tests | Build | Test | Notes |
|---|---|---|---|---|---|
| `@rudderjs/panels` | 167 `.ts(x)` | 21 test files / **620 tests** | ✅ green | ✅ green | Last green: 2026-04-09 after task A/B/C commit |
| `@rudderjs/panels-lexical` | 17 `.ts(x)` | 2 test files / **21 tests** | ✅ green | ✅ green | |

### Cross-package dependency direction

**`panels-lexical` depends on `panels`** (single direction, confirmed).

- `panels-lexical/package.json` declares `@rudderjs/panels` as a `peerDependency`
- 4 source files import from `@rudderjs/panels`:
  - `register.ts`: `registerField` (runtime)
  - `RichContentField.ts`: `Field` class (runtime) + `BlockMeta` type
  - `lexical/BlockNodeComponent.tsx`: `FieldMeta`, `BlockMeta` (type-only)
  - `LexicalEditor.tsx`: `BlockMeta` (type-only)
  - `PanelLexicalServiceProvider.ts`: `PanelPlugin` (type-only)

**`panels` does NOT depend on `panels-lexical` at runtime.** The 4 grep hits inside `panels/src` for `@rudderjs/panels-lexical` are all comments, JSDoc, or test fixtures — no `import` statements. Confirmed via:
- `PanelServiceProvider.ts:185` — JSDoc example
- `handlers/chat/blockCatalog.ts:13,50` — comments explaining where blocks come from
- `registries/EditorRegistry.ts:37` — deprecated comment
- `__tests__/blockCatalog.test.ts:111` — test fixture comment

**Implication for extraction order:** extract `@pilotic/panels` first, `@pilotic/lexical` second. The lexical package will pin `@pilotic/panels` as a peer.

### Other consumers of `@rudderjs/panels` in the monorepo

| Package | Consumer type | Impact |
|---|---|---|
| `@rudderjs/panels-lexical` | runtime + types | Will become `@pilotic/lexical`, follows panels in extraction |
| `@rudderjs/media` | runtime: `Field`, `registerField`, `registerLazyElement`, `PanelPlugin` type | Will need to consume `@pilotic/panels` from npm post-extraction. Optional plugin — works with or without |
| `@rudderjs/workspaces` | runtime: `Field`, `Panel`, `PanelPlugin` type | Same as media — will consume `@pilotic/panels` from npm. Optional plugin |
| `@rudderjs/ai` | **doc comment only** (`packages/ai/src/types.ts:311`) | ✅ no real coupling — no rebuild needed |
| `@rudderjs/core` | **README example only** | ✅ no code coupling |

**Cross-package decisions:** `@rudderjs/media` and `@rudderjs/workspaces` are framework packages (live in `rudderjs/rudder`) but they import from `@rudderjs/panels` which will move to `pilotic/pilotic`. Two options:
1. **Bump them to depend on `@pilotic/panels` from npm** after extraction. Cleanest, but introduces a cross-repo version coupling that bites every release.
2. **Move them to `pilotic/pilotic` too** since they're conceptually panel extensions. Probably the right call long-term — they're not framework primitives, they're admin/CMS features. Worth flagging as a Phase 2 sub-decision.

**Recommendation:** **Move `media` and `workspaces` to `pilotic/pilotic`** as `@pilotic/media` and `@pilotic/workspaces` during Phase 2. They have no consumers outside of admin/CMS use cases. This expands Phase 2's scope but eliminates the cross-repo coupling for two more packages.

### Playground consumer surface

The playground imports from `@rudderjs/panels` in **~70 files** across `bootstrap/`, `app/Panels/`, and `pages/(panels)/_components/**`. All of those are end-user code that will need to be updated to `@pilotic/panels` during Phase 2 — but it's a single find-and-replace in the playground, not an architectural change.

### File-level extraction map for `@rudderjs/panels`

Buckets:
- **CORE** → stays in `@pilotic/panels` (free, public)
- **AI** → moves to `@pilotic-pro/ai` (private, commercial)
- **TBD** → has cross-bucket coupling that needs Phase 3 (extension hooks) to resolve

#### CORE (167 files — stays)

```
src/
├── Panel.ts                              # main runtime class
├── Page.ts
├── Resource.ts                           # ⚠️ type-imports PanelAgent — see TBD section
├── Global.ts
├── PanelServiceProvider.ts               # ⚠️ registers AI actions — see TBD section
├── ThemeSettingsPage.ts
├── NodeMap.ts
├── debug.ts
├── datasource.ts
├── persist.ts
├── resolveSchema.ts
├── resourceData.ts
├── types.ts
├── index.ts                              # ⚠️ re-exports AI types — see TBD section
├── i18n/{ar,en,index}.ts                 # localization (just shipped)
├── theme/*.ts                            # 11 files — theming
├── handlers/
│   ├── index.ts
│   ├── panelMiddleware.ts
│   ├── dashboardRoutes.ts
│   ├── globalRoutes.ts
│   ├── metaRoutes.ts
│   ├── notificationRoutes.ts
│   ├── themeRoutes.ts
│   ├── versionRoutes.ts
│   ├── types.ts
│   ├── meta/*.ts                         # 8 files — meta endpoints
│   ├── resource/*.ts                     # 8 files — CRUD handlers
│   └── shared/*.ts                       # 5 files — coercion/validation/transforms
├── registries/                           # 12 files — Panel/Resolver/etc registries
├── resolvers/                            # 15 files — schema → meta resolvers
├── schema/
│   ├── *.ts                              # ~30 schema element classes
│   ├── fields/*.ts                       # 19 field type classes
│   ├── filters/*.ts                      # 4 filter classes
│   ├── Field.ts                          # ⚠️ runtime-imports BuiltInAiActionRegistry — see TBD section
│   └── ...
└── utils/queryHelpers.ts
```

**Test files in CORE bucket** (15 of 21):
`chart`, `field`, `fields`, `form`, `i18n`, `i18n-override`, `list`, `persist`, `registries`, `resource`, `section`, `stats`, `table`, `tabs`, `viewmode`, `widget`

#### AI (23 source files + 6 test files — moves to `@pilotic-pro/ai`)

```
src/
├── agents/
│   ├── PanelAgent.ts                     # base class — runtime + system prompt
│   └── types.ts                          # PanelAgentMeta, PanelAgentContext
├── ai-actions/
│   ├── index.ts                          # public re-export
│   ├── registry.ts                       # BuiltInAiActionRegistry
│   └── builtin.ts                        # 8 built-in actions: rewrite, expand, etc.
├── conversation/
│   └── PrismaConversationStore.ts        # AI chat persistence
├── handlers/
│   ├── agentRun.ts                       # standalone agent run endpoint
│   ├── agentStream/
│   │   ├── index.ts                      # SSE streaming
│   │   └── runStore.ts                   # cache-backed run state (sub-agent resume)
│   └── chat/
│       ├── chatHandler.ts                # main chat dispatcher
│       ├── continuation.ts               # client-tool round-trip validation
│       ├── conversationManager.ts        # auto-title, persistence orchestration
│       ├── persistence.ts                # AiMessage[] graph persist/load
│       ├── subAgentResume.ts             # sub-agent dispatch/resume bridging
│       ├── lazyImports.ts
│       ├── selectionInstructions.ts      # selection-mode prompt block
│       ├── blockCatalog.ts               # extracts BuilderField blocks for prompts
│       ├── index.ts
│       ├── types.ts
│       ├── contexts/
│       │   ├── resolveContext.ts
│       │   ├── types.ts
│       │   ├── ResourceChatContext.ts
│       │   ├── PageChatContext.ts        # (stub)
│       │   └── GlobalChatContext.ts
│       └── tools/
│           ├── deleteRecordTool.ts       # server tool, needsApproval
│           ├── editTextTool.ts           # server tool — Yjs surgical edits
│           ├── readFormStateTool.ts      # client tool
│           ├── runAgentTool.ts           # sub-agent dispatch
│           └── updateFormStateTool.ts    # client tool — write side
```

**Test files in AI bucket** (6 of 21):
`blockCatalog`, `chat-contexts`, `chat-mixed-tools`, `chat-persistence`, `subagent-runStore`, plus the AI portions of `resource.test.ts`

#### Chat UI (in `packages/panels/pages/_components/agents/` — moves with AI)

```
pages/_components/agents/
├── AiActionProgress.tsx
├── AiChatContext.tsx
├── AiDropdown.tsx
├── agentRunRenderer.tsx
├── clientTools.ts                        # ⚠️ may need to stay shared — see TBD
├── lexicalRegistry.ts                    # ⚠️ may need to stay shared — see TBD
├── toolRenderers.ts
├── updateFormStateHandler.ts
└── useAgentRun.ts
```

These files are authored in `packages/panels/pages/` and **mirrored to playground** via `pnpm rudder vendor:publish --tag=panels-pages` (registered at `PanelServiceProvider.ts:91`). In the extraction:
- `panels-pages` tag becomes `pilotic-pages`
- The agents/ subfolder migrates from the panels mirror to the pro AI package's mirror — likely a new tag like `pilotic-ai-pages`
- Means `vendor:publish` may need to support multi-source tags (one tag, multiple package sources). Or the pro package gets its own tag and the playground runs both publish commands.

#### TBD — cross-bucket couplings that need Phase 3 (extension hooks) before extraction

There are **5 places where CORE imports from AI**. These are the seams that Phase 3 must resolve:

| # | File | Imports | Severity | Resolution path |
|---|---|---|---|---|
| 1 | `PanelServiceProvider.ts:7,57-58` | `BuiltInAiActionRegistry`, `builtInActions` (registers built-in AI actions in `register()`) | **High** | Move the action registration into the pro provider's `register()` instead of core. Free package ships an empty registry; pro populates it. |
| 2 | `schema/Field.ts:3,592` | `BuiltInAiActionRegistry` (runtime — `Field.ai()` calls `BuiltInAiActionRegistry.get(slug)` to resolve string slugs) | **High** | Free `BuiltInAiActionRegistry.get()` returns `undefined` for unknown slugs; without pro, `.ai(['rewrite'])` throws a helpful "install @pilotic-pro/ai" error instead of crashing. The registry shape stays in core, the population moves to pro. |
| 3 | `schema/Field.ts:2` | `PanelAgent` (type-only) | Low | Keep `PanelAgent` as a thin **interface** in core (`agents/PanelAgent.ts` becomes the abstract type definition), full runtime moves to pro. Type-only import is fine. |
| 4 | `Resource.ts:5-6` | `PanelAgent`, `PanelAgentMeta` (type-only) | Low | Same — type-only, resolved by leaving the interface in core. |
| 5 | `index.ts:231-234` | Re-exports `PanelAgent`, `PanelAgentContext`, `PanelAgentFieldType`, `PanelAgentMeta`, `BuiltInAiActionRegistry`, `builtInActions` from the public package entry | Medium | Free package re-exports the **interfaces** only. Concrete `PanelAgent` class + `BuiltInAiActionRegistry` populate via pro. Public type surface preserved; runtime class lives in pro. |

**Internal AI→AI dependency** (not a leak, but worth noting):
- `agents/PanelAgent.ts:2` imports `buildSelectionInstructions` from `handlers/chat/selectionInstructions.js` — agents and chat are intertwined. Both move to pro together, no action needed.

**Pages-side TBD** (in `pages/_components/agents/`):
- `clientTools.ts` and `lexicalRegistry.ts` may have non-AI consumers. Need a deeper grep in Phase 3 — if non-AI fields in core also use them, they stay; if only AI uses them, they move with AI.

#### Verdict on extraction readiness

**Core is mostly clean.** Of 167 source files in `panels/src`:
- **162 files** have ZERO imports from `agents/`, `ai-actions/`, `conversation/`, `handlers/agentRun.ts`, `handlers/agentStream/`, or `handlers/chat/**`
- **5 files** have couplings — all of them resolvable via Phase 3 hooks without cross-cutting refactors:
  - 2 type-only (trivial)
  - 1 import via index re-export (cosmetic)
  - 2 runtime (`PanelServiceProvider` action registration + `Field.ai()` slug resolver) — both fixable by moving the *population* to the pro provider while keeping the *interface* in core

**No core file imports from `handlers/chat/**`.** This is the strongest signal that the AI extraction is feasible — the entire chat surface is genuinely contained.

### `panels-lexical` extraction map

```
src/
├── index.ts                              # public entry
├── server.ts                             # /server entry — exports the service provider
├── PanelLexicalServiceProvider.ts        # plugin registration
├── register.ts                           # registerField calls
├── LexicalEditor.tsx                     # CORE: the main editor component
├── CollaborativePlainText.tsx            # ⚠️ "Collaborative" in the name — but the file is the editor primitive; collab is per-instance
├── RichContentField.ts                   # Field class subtype
├── toolbar.ts                            # toolbar profile resolution
├── hooks/
│   └── useYjsCollab.ts                   # ⚠️ COLLAB — moves to @pilotic-pro/collab
├── lexical/
│   ├── BlockNode.tsx
│   ├── BlockNodeComponent.tsx
│   ├── SlashCommandPlugin.tsx
│   ├── FixedToolbarPlugin.tsx
│   ├── FloatingLinkEditorPlugin.tsx
│   ├── FloatingToolbarPlugin.tsx
│   ├── InsertParagraphAtEndPlugin.tsx
│   └── AddBlockHandlePlugin.tsx
└── types/y-websocket.d.ts                # type stub — moves with collab
```

**Critical finding for the collab split**: `@rudderjs/panels-lexical` already declares `yjs`, `y-websocket`, and `y-indexeddb` as **optional** peer dependencies (`peerDependenciesMeta` in `package.json:54-64`). This means **`panels-lexical` is already designed to run without collab at the dependency level**. The free `@pilotic/lexical` will work in local-only mode by simply not installing the Yjs peers; the pro `@pilotic-pro/collab` will declare them as required.

**Collab files to extract** (much smaller than I assumed):
- `hooks/useYjsCollab.ts` — the only file that hard-depends on Yjs
- `types/y-websocket.d.ts` — type stub
- The `LexicalEditor.tsx` Yjs integration is conditional on `useYjsCollab` being passed — refactor to inject the Yjs binding via Phase 3's `LexicalCollabPlugin` hook so the editor knows nothing about Yjs internals

That's it. **Collab is ~2 files of `panels-lexical` plus the conditional injection in LexicalEditor.tsx.** Far smaller than I estimated in the original plan.

### Chat UI authoring/mirror flow (confirmed)

- **Source of truth:** `packages/panels/pages/**`
- **Mirror destination:** `playground/pages/(panels)/**`
- **Mirror command:** `pnpm rudder vendor:publish --tag=panels-pages` (registered in `PanelServiceProvider.boot()` at line 91)
- **Memory note:** `feedback_panels_pages_parallel_copy.md` — must run `--force` after every edit

In the extraction:
- The `panels-pages` tag becomes `pilotic-pages`, owned by `@pilotic/panels`
- The chat UI subfolder (`pages/_components/agents/**`) needs to migrate to `@pilotic-pro/ai`'s page mirror, likely under a new tag `pilotic-ai-pages`
- This is the mechanism that makes "free panels chat-less, pro panels with chat" work at the file level — the playground only gets the AI components if `@pilotic-pro/ai` is installed

### Surprises (things I didn't predict in the original plan)

1. **`media` and `workspaces` are panel extensions, not framework features.** They should move to `pilotic/pilotic` too. This expands Phase 2 from "2 packages → 4 packages" but eliminates a future cross-repo coupling.
2. **`@rudderjs/ai` has zero code coupling to `@rudderjs/panels`.** A doc comment is the only mention. The two packages communicate via the chat handler / agent loop interface, not via direct imports. Clean separation.
3. **`panels-lexical` collab is much smaller than I estimated** — basically 1 hook + 1 type stub + a conditional plug-point in `LexicalEditor.tsx`. Phase 5 is now a half-day, not a multi-day effort.
4. **`PanelServiceProvider.register()` already publishes a `panels-translations` vendor tag for the localization starter** (line 75) — wait, that's `pilotic-translations` post-task A. The schema and pages tags (`panels-schema`, `panels-pages`) still use `panels-` prefix. Phase 2 will rename all three together.
5. **Test file split for AI** — 6 of 21 test files are AI-specific and move with the AI extraction. Means free `@pilotic/panels` ships with 615 tests, pro `@pilotic-pro/ai` ships with ~5–6 tests (small surface, more verification needed during Phase 4).
6. **`Field.ai()` is the trickiest coupling.** The string-slug shorthand (`.ai(['rewrite'])`) bakes the AI action registry into the schema. Resolution is clean (free returns undefined, pro populates) but it's the one user-facing API surface where free vs pro behavior diverges visibly.

### Action items before Phase 1 starts

These are not code changes — just decisions to record.

- [ ] **Decide: do `media` and `workspaces` move to `pilotic/pilotic` in Phase 2?** Recommendation: **yes** (they're admin/CMS extensions, not framework primitives).
- [ ] **Decide: `Field.ai(['rewrite'])` behavior in free `@pilotic/panels` without pro installed.** Options: (a) silent no-op (the field renders no AI button), (b) helpful error pointing at `@pilotic-pro/ai`, (c) types-only — `.ai()` exists at the type level but is a no-op at runtime. Recommendation: **(b)** — fail loudly and informatively at form-build time, like the current `unknown AI action` error does.
- [ ] **Decide: chat UI vendor:publish tag strategy.** Option (a) one tag, two source packages (requires `@rudderjs/cli` extension). Option (b) two tags, both run on each playground sync (current pattern, less elegant). Recommendation: **(b)** for v1, **(a)** as a follow-up CLI improvement.
- [ ] **Decide: `panels-schema` vendor tag rename.** Becomes `pilotic-schema`. Just confirm.
- [ ] **Decide: Phase 3's `PanelAgent` interface vs class split.** Free `@pilotic/panels` exports `PanelAgent` as a TypeScript `interface` (the type contract); pro `@pilotic-pro/ai` exports `PanelAgent` as a runtime `class` that *implements* the interface. Same import path looks different to consumers depending on whether pro is installed. This is the cleanest pattern but requires careful TypeScript handling — flag as a Phase 3 design item.

