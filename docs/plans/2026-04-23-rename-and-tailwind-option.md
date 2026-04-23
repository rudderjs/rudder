# Repo Rename + Scaffolder Tailwind Option

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Two housekeeping items bundled into one plan because they touch the same three-repo setup and are best executed in order:

1. Rename the local working directory `~/Projects/rudderjs` → `~/Projects/rudder` to match the actual GitHub repo name (`github.com/rudderjs/rudder` — `rudderjs` is the org, `rudder` is the repo).
2. Propagate the rename to `pilotiq` and `pilotiq-pro`, which reference `../rudderjs/packages/*` via `pnpm.overrides`.
3. Make Tailwind an **opt-in** choice in `create-rudder-app`. The `ctx.tailwind` flag already exists but is half-wired — today every view template emits Tailwind utility classes regardless, so `--no-tailwind` produces an unstyled app. Fix by introducing a plain-CSS variant of all scaffolded views.

**Non-goals:**
- Renaming the npm scope (`@rudderjs/*` stays — directory rename is local-only).
- Renaming the GitHub repo or org (both already correct upstream).
- Redesigning the Welcome/Auth/Demo pages — plain variant just needs to look decent, not match Tailwind pixel-for-pixel.

---

## Current State

### Directory rename
- Local path: `/Users/sleman/Projects/rudderjs/`
- GitHub repo: `github.com/rudderjs/rudder` (name is `rudder`, org is `rudderjs`)
- Claude memory dir: `~/.claude/projects/-Users-sleman-Projects-rudderjs/` — path is derived from cwd, so it must move in lockstep or Claude will lose all session memory in this repo.
- Hard-coded path references inside this repo:
  - `CLAUDE.md:209` playground table row
  - `CLAUDE.md:216` `cd ~/Projects/rudderjs/playground && pnpm dev`
  - `CLAUDE.md:227` `rudderjs/playground structure` heading
  - (Audit the whole file — these are the ones already spotted.)
- `README.md` references `github.com/rudderjs/rudder.git` (correct, no change needed).

### Sibling repos
- `pilotiq`: 32 `link:../rudderjs/packages/*` entries in `package.json` `pnpm.overrides`; 2 CLAUDE.md references.
- `pilotiq-pro`: 31 `link:../rudderjs/packages/*` entries; 2 CLAUDE.md references.
- Both need `pnpm install` after the rewrite to regenerate the linked store.

### Scaffolder Tailwind flag
- `TemplateContext.tailwind: boolean` already threaded through `create-rudder-app/src/templates.ts`.
- What the flag *currently* gates (correctly):
  - Tailwind deps in `package.json` (lines 230–241)
  - `import '@/index.css'` at the top of each view (~12 callsites)
  - `tailwindcss()` plugin in `vite.config.ts` (line 398)
  - `@import "tailwindcss"` in the root CSS file (lines 701–706)
- What the flag *does not* gate (the bug):
  - className values in every view template. `welcomeViewReact` (line 2119), `welcomeViewVue` (line 2245), `welcomeViewSolid` (line 2373), plus all auth views and all demo views emit Tailwind utility classes unconditionally.
- Template surface that needs a plain-CSS variant:
  - **Welcome** (React/Vue/Solid) — 3 files
  - **Auth** (Login, Register, ForgotPassword, ResetPassword) × 3 frameworks — 12 files
  - **Demos** (Contact, Live, WS, Todos) × 3 frameworks — 12 files
  - **Total:** 27 view templates (all currently inside `templates.ts`)

---

## Design Decisions

### Rename: execute in the correct sequence

Order matters — if the memory dir or sibling overrides go out of sync at any point, tooling breaks mid-flight. Sequence:

1. **Close all Claude sessions in this repo first** (memory dir move must happen when nothing holds it open).
2. Rename the Claude memory dir `~/.claude/projects/-Users-sleman-Projects-rudderjs/` → `-Users-sleman-Projects-rudder/`.
3. Rename the working dir `~/Projects/rudderjs/` → `~/Projects/rudder/`.
4. Update CLAUDE.md + any remaining path references inside `rudder`, commit.
5. Rewrite sibling `pnpm.overrides`, update their CLAUDE.md files, `pnpm install`, verify dev boots, commit in each sibling.

Every step is reversible up to the sibling `pnpm install` — which will fail loudly (not silently corrupt) if a path is wrong.

### Tailwind: semantic class names + two CSS variants (single JSX source)

Three approaches were considered:

| Approach | Maintenance burden | Upfront work |
|---|---|---|
| A. Duplicate JSX: emit `<View>Tailwind.tsx` or `<View>Plain.tsx` variant | **2×** every future template edit | Low |
| B. Shared JSX with semantic class names (`welcome-nav`, `feature-card`, …) + two CSS files | 1× JSX + occasional CSS edit | Medium (one-time refactor of 27 templates) |
| C. Always install Tailwind regardless | 1× | Trivial, but violates user's option B preference |

**Picking B.** The scaffolder is actively evolving (3 publishes in the last week — 0.0.19/0.0.20/0.0.21). JSX is where the churn happens; CSS files are stable. Approach B pays a one-time refactor cost in exchange for a single source of JSX truth forever. Approach A would double the cost of every subsequent template edit.

**How the two CSS variants are authored:**

- **Tailwind variant** — `app/index.css` uses Tailwind v4 `@apply`:
  ```css
  @import "tailwindcss";
  .welcome-nav { @apply mx-auto flex max-w-6xl items-center justify-between px-6 py-5; }
  .feature-card { @apply rounded-xl border border-zinc-200 bg-white p-6 ...; }
  ```
- **Plain variant** — `app/index.css` is hand-written, matching the same class selectors:
  ```css
  :root { --bg: #fff; --fg: #18181b; --muted: #71717a; --border: #e4e4e7; }
  @media (prefers-color-scheme: dark) { :root { --bg: #000; --fg: #fafafa; … } }
  body { background: var(--bg); color: var(--fg); font-family: system-ui, sans-serif; }
  .welcome-nav { max-width: 72rem; margin: 0 auto; display: flex; … }
  .feature-card { border-radius: 0.75rem; border: 1px solid var(--border); … }
  ```

Dark mode via `prefers-color-scheme` media query. No JS toggle — matches what the Tailwind version already does via `dark:` variants which respond to the same signal.

### Index.css always emitted

Current code makes `import '@/index.css'` conditional on `ctx.tailwind`. After this plan, the CSS import is **unconditional** — the file always exists, its *contents* differ based on the flag. This simplifies the scaffolder (one branch in CSS generation, zero branches in JSX).

---

## Phase 1: Directory Rename

### Task 1.1: Move Claude memory dir

**Precondition:** No Claude Code session open in `~/Projects/rudderjs/` (kill any running sessions first).

```bash
mv ~/.claude/projects/-Users-sleman-Projects-rudderjs ~/.claude/projects/-Users-sleman-Projects-rudder
```

**Verify:** `ls ~/.claude/projects/-Users-sleman-Projects-rudder/memory/MEMORY.md` exists.

### Task 1.2: Rename the working directory

```bash
mv ~/Projects/rudderjs ~/Projects/rudder
cd ~/Projects/rudder
```

**Verify:** `pwd` prints `/Users/sleman/Projects/rudder`; `git status` shows clean tree.

### Task 1.3: Update path references inside this repo

Audit and rewrite. Use:

```bash
grep -rn "Projects/rudderjs\|~/rudderjs\|rudderjs/playground\|rudderjs/packages" . \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  --exclude-dir=.claude --exclude="*.html"
```

Known hits to rewrite in `CLAUDE.md`:
- Playground table row — `rudderjs/playground` label is user-facing naming, keep as-is (it describes the repo on GitHub).
- `cd ~/Projects/rudderjs/playground` → `cd ~/Projects/rudder/playground` (line 216)
- `### rudderjs/playground structure` heading — keep (describes the repo by its public name).

In other words: **file-system paths change, repo-name references don't**. The GitHub repo is still `rudderjs/rudder`; documentation that names the repo should keep that name.

**Verify:** re-run the grep — zero hits for `Projects/rudderjs`.

### Task 1.4: Smoke test before touching siblings

```bash
pnpm install         # no-op, but confirms pnpm-lock.yaml paths still resolve
pnpm build
cd playground && pnpm dev   # verify :3000 boots
```

**Verify:** playground renders at http://localhost:3000. Kill dev server.

### Task 1.5: Commit the internal updates

Branch name: `chore/rename-dir-rudder`. Commit message:

```
chore: update internal path references after rudderjs → rudder dir rename

Local working directory renamed from ~/Projects/rudderjs to ~/Projects/rudder
to match the actual repo name (rudderjs/rudder on GitHub).

Scope: CLAUDE.md filesystem-path references only. npm scope (@rudderjs/*),
GitHub repo name (rudderjs/rudder), and README references are unchanged.
```

---

## Phase 2: Sibling Repo Sync

### Task 2.1: Update `pilotiq` overrides + CLAUDE.md

```bash
cd ~/Projects/pilotiq
sed -i '' 's|link:../rudderjs/packages/|link:../rudder/packages/|g' package.json
sed -i '' 's|../rudderjs/packages|../rudder/packages|g' CLAUDE.md
```

**Verify:** `grep -c "link:../rudder/packages" package.json` returns 32 (matches the previous count).

`pnpm install` and boot the pilotiq playground once to confirm links resolve:

```bash
pnpm install
pnpm build
cd playground && pnpm dev    # :3001
```

**Verify:** http://localhost:3001 renders. Kill server.

Commit on branch `chore/rename-rudder-overrides`. Push, open PR.

### Task 2.2: Update `pilotiq-pro` overrides + CLAUDE.md

```bash
cd ~/Projects/pilotiq-pro
sed -i '' 's|link:../rudderjs/packages/|link:../rudder/packages/|g' package.json
sed -i '' 's|../rudderjs/packages|../rudder/packages|g' CLAUDE.md
```

**Verify:** `grep -c "link:../rudder/packages" package.json` returns 31.

```bash
pnpm install
pnpm build
cd playground && pnpm dev    # :3002
```

**Verify:** http://localhost:3002 renders. Kill server.

Commit on branch `chore/rename-rudder-overrides`. Push, open PR.

### Task 2.3: Update cross-repo memory references

Grep all three memory dirs for `Projects/rudderjs`:

```bash
grep -rln "Projects/rudderjs\|../rudderjs/" ~/.claude/projects/*-Projects-*/memory/ 2>/dev/null
```

Rewrite matches with `sed -i ''`. These are just documentation strings — no behavioral impact — but stale paths age the memory into misleading territory fast.

---

## Phase 3: Scaffolder Tailwind Option

### Task 3.1: Design the semantic class-name vocabulary

Before refactoring any template, enumerate the class names used across all 27 views so both CSS variants stay in sync. Produce `create-rudder-app/src/templates/STYLES.md` (temporary working doc, delete before publish) listing every semantic class + its intended purpose:

- Layout: `.page`, `.page-nav`, `.page-main`, `.page-footer`
- Welcome: `.welcome-hero`, `.welcome-title`, `.welcome-meta`, `.feature-grid`, `.feature-card`, `.feature-title`, `.feature-desc`
- Auth: `.auth-wrap`, `.auth-card`, `.auth-title`, `.auth-field`, `.auth-label`, `.auth-input`, `.auth-submit`, `.auth-error`, `.auth-link-row`
- Demos: `.demo-wrap`, `.demo-title`, `.demo-description`, `.demo-form`, `.demo-input`, `.demo-button`, `.demo-output`, `.demo-list`, `.demo-list-item`
- Utility: `.signed-in-badge`, `.primary-button`, `.secondary-button`, `.muted`, `.divider`

Aim for ~25 class names total. If the list balloons past ~40, we've drifted too close to Tailwind-utility granularity — consolidate.

### Task 3.2: Refactor Welcome view (React) to semantic classes

Edit `welcomeViewReact()` at `create-rudder-app/src/templates.ts:2119`. Replace every `className="<tailwind utilities>"` with the corresponding semantic class name from Task 3.1. JSX structure unchanged.

**Verify:** emitted file renders structurally identical markup; diff only affects className attributes.

### Task 3.3: Refactor Welcome views (Vue + Solid)

Same as 3.2 for `welcomeViewVue()` (line 2245) and `welcomeViewSolid()` (line 2373). Vue uses `:class`, Solid uses `class` — the class *names* are identical.

### Task 3.4: Refactor auth views

The auth view generators (find via `grep -n "authView\|loginView\|registerView" create-rudder-app/src/templates.ts`). Same transformation: Tailwind utilities → semantic classes. 12 views.

### Task 3.5: Refactor demo views

Same for Contact, Live, WS, Todos × 3 frameworks. 12 views.

### Task 3.6: Emit `app/index.css` — Tailwind variant

Update the CSS generator (line 701–706 region). When `ctx.tailwind === true`, emit:

```css
@import "tailwindcss";

/* Layout */
.page { @apply min-h-svh bg-gradient-to-b from-white to-zinc-50 text-zinc-900 dark:from-zinc-950 dark:to-black dark:text-zinc-100; }
.page-nav { @apply mx-auto flex max-w-6xl items-center justify-between px-6 py-5; }
/* ... one rule per semantic class from Task 3.1 ... */
```

Port every Tailwind utility combination from the pre-refactor templates into an `@apply` rule. If Tailwind v4 rejects any specific `@apply` combination (some arbitrary-value utilities aren't `@apply`-able), fall back to raw CSS with the equivalent declarations.

### Task 3.7: Emit `app/index.css` — plain variant

When `ctx.tailwind === false`, emit hand-authored CSS with the same class selectors. Use CSS variables for theme tokens so dark mode is one media-query block:

```css
:root {
  --bg-start: #fff;
  --bg-end: #fafafa;
  --fg: #18181b;
  --fg-muted: #52525b;
  --border: #e4e4e7;
  --accent: #10b981;
  --card-bg: #fff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg-start: #09090b;
    --bg-end: #000;
    --fg: #fafafa;
    --fg-muted: #a1a1aa;
    --border: #27272a;
    --card-bg: #09090b;
  }
}

* { box-sizing: border-box; }
body { margin: 0; background: linear-gradient(to bottom, var(--bg-start), var(--bg-end)); color: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; }

.page { min-height: 100svh; }
.page-nav { max-width: 72rem; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 1.5rem; }
/* ... one rule per semantic class ... */
```

Target: the plain variant should look "minimal but polished" — not a design showcase, but not obviously-broken either. Users who want more will either switch to the Tailwind variant or bring their own design system.

### Task 3.8: Unconditional CSS import

Remove the `ctx.tailwind ? 'import "@/index.css"\n' : ''` branching at the 12 callsites (lines 1823, 1910, 1989, 2120, 2246, 2374, 2548, 2590, 2622, 2824, 2918, 3004, 3134, 3230, 3313). The import is now always present — its contents differ, not its existence.

### Task 3.9: Update `templates.test.ts`

Add a test case for `tailwind: false`:
- Asserts the `package.json` has **no** `tailwindcss` / `@tailwindcss/vite` deps.
- Asserts `vite.config.ts` has **no** `tailwindcss()` plugin.
- Asserts `app/index.css` exists and does **not** contain `@import "tailwindcss"`.
- Asserts `app/index.css` contains at least `.page`, `.feature-card`, `.auth-card` selectors.
- Asserts `app/Views/Welcome.tsx` contains `import '@/index.css'`.

Existing Tailwind=true tests should continue to pass unchanged.

### Task 3.10: Expose the prompt in `index.ts`

Find the scaffolder's multiselect/question flow in `create-rudder-app/src/index.ts` (291 lines). Add a Tailwind yes/no prompt between the framework and packages questions. Default: **yes** (Tailwind is still the recommended path; this is an opt-out, not opt-in).

### Task 3.11: End-to-end smoke test

```bash
cd /tmp && rm -rf rudder-plain && npx create-rudder-app rudder-plain --no-tailwind --install
cd rudder-plain && pnpm rudder providers:discover
pnpm dev
```

**Verify in browser:**
- `/` renders with visible layout (hero, cards, footer, nav).
- `/login`, `/register` render with form styling (bordered card, labeled inputs).
- Dark mode switches via OS setting.
- No broken-looking white-on-white or zero-margin page.

Same smoke with `--tailwind` (the default) should still look pixel-identical to the current published output.

### Task 3.12: Ship as `create-rudder-app@0.0.22`

```bash
pnpm changeset        # "feat(create-rudder-app): make Tailwind optional with plain-CSS variant"
pnpm changeset:version
pnpm release
```

---

## Rollout Order

Single session, three PRs, landed in this order:

1. **PR A** (rudder repo): Phase 1 internal rename updates. Low-risk, nothing external changes.
2. **PR B** (pilotiq + pilotiq-pro): Phase 2 override sync. Two parallel PRs, must both merge before any cross-repo session runs again.
3. **PR C** (rudder repo): Phase 3 scaffolder Tailwind option. Independent of phases 1–2; only lands on its own branch and doesn't touch sibling repos.

Phases 1–2 should land first because they're mechanical/reversible; phase 3 is the bulk of the work and benefits from being reviewed on a clean base.

---

## Risks & Rollback

- **Memory dir rename timing:** If any Claude session is live during the move, it'll keep writing to the old path and appear to lose updates. Close sessions first; no automated way to detect this.
- **Sibling `pnpm install` cache weirdness:** pnpm caches resolved paths. If `pnpm install` after the override rewrite still resolves from the old path, delete `node_modules` and `pnpm-lock.yaml` before re-installing. Both sibling repos have a CI workflow that will flag this.
- **Tailwind `@apply` edge cases:** Tailwind v4 is stricter about `@apply`-ing arbitrary-value utilities. If any `@apply` rule in Task 3.6 fails to compile, replace that specific rule with the expanded raw CSS — don't abandon the approach.
- **Plain-CSS variant looking worse than expected:** Easy to iterate on after publish. No migration path needed — users who scaffolded the plain variant and want Tailwind can add it themselves; it's a starter template, not an SDK.
- **Rollback path for the rename:** `mv ~/Projects/rudder ~/Projects/rudderjs`, revert the sibling override commits, `pnpm install` in siblings. Claude memory dir move is symmetric.

---

## Success Criteria

- [ ] `pwd` in this repo prints `/Users/sleman/Projects/rudder`.
- [ ] `grep -rn "Projects/rudderjs" ~/Projects/{rudder,pilotiq,pilotiq-pro}` returns only GitHub-URL references (not filesystem paths).
- [ ] All three playgrounds boot (`:3000`, `:3001`, `:3002`) and render their landing pages.
- [ ] `npx create-rudder-app foo --no-tailwind --install && cd foo && pnpm dev` produces a styled landing page.
- [ ] `npx create-rudder-app foo` (Tailwind on, default) produces a visually-unchanged landing page vs. current published output.
- [ ] Claude memory in this repo is preserved across the rename (MEMORY.md shows its prior entries).
- [ ] `create-rudder-app@0.0.22` published to npm.
