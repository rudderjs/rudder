# `npm create rudder` — drop the `-app` suffix from the scaffolder

**Status:** plan, 2026-05-21. Pickup task for the next framework session.
**Origin:** session 2026-05-21 — the brand rebrand from `RudderJS` → `Rudder` (PR #570/#572/site #45/#46/#47) closed the loop on every visible product surface except the install command. The cli, the runtime banners, the README, the docs, and the site all say `Rudder`; the install command still says `npm create rudder-app@latest`. Aligning the install with the brand closes that last gap.

---

## Why this exists

The `-app` suffix on `create-<name>-app` was the convention circa 2016–2020 (`create-react-app`, `create-next-app`, `create-nuxt-app`). Modern frameworks have moved off it:

| Framework | Install command | Notes |
|---|---|---|
| Vite | `npm create vite@latest` | Shipped without the suffix from day one |
| Vue 3 | `npm create vue@latest` | Was `create-vue-app`; renamed |
| Astro | `npm create astro@latest` | |
| Solid | `npm create solid@latest` | |
| Hono | `npm create hono@latest` | |
| Remix | `npm create remix` | |
| Next.js | `npm create next-app` | Still on the suffix (notable holdout) |
| Nest | `npm i -g @nestjs/cli` + `nest new` | Different pattern entirely |

Among the "modern, fast, opinionated" peers (Vite/Vue/Astro/Solid/Hono/Remix), every one is on the bare name. Suffix-keeping is the dated convention.

Two reasons it matters specifically now:

1. **Brand alignment.** We just rebranded everywhere user-visible. `npm create rudder@latest` reads as the brand; `npm create rudder-app@latest` reads as brand + leftover suffix.
2. **Marketing surfaces.** Every README snippet, every blog post, every Stack Overflow answer carries that command forever. 4 fewer characters compound.

## Goals

- **Both commands work.** Users with the old command in muscle memory or in cached blog posts don't get a "package not found" error.
- **New command is the documented one.** Every place the framework prints / writes the install command uses the new form going forward.
- **No code duplication.** One source of truth for the scaffolder logic; the new package is a thin redirect.
- **Soft, visible deprecation.** Users on the old command see a one-line nudge in the install output, not a scary warning that blocks anything.

## Non-goals

- **Not renaming the GitHub repo** (`rudderjs/rudder`) or the npm scope (`@rudderjs/*`). Those are infrastructure names.
- **Not unpublishing `create-rudder-app`.** It stays installable forever; we don't want to break links.
- **Not changing the scaffolder's behavior or prompt flow.** Just the installable name.

## Locked design decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Stub `create-rudder`, source-of-truth stays in `create-rudder-app/`.** The new package is a tiny `package.json` + `bin/index.mjs` that spawns the existing `create-rudder-app` bin (or imports its `main()` directly). | Renaming the workspace folder mid-life breaks git history, smoke tests, recipe references, the `pnpm pack` flow, and CI matrix cell names. The stub approach keeps the diff small + reversible. |
| 2 | **Banner deprecation, not `package.json#deprecated`.** When `create-rudder-app` runs, print one line at the top of the output: "Heads up: this scaffolder now ships as `create-rudder` — use `npm create rudder@latest` next time." | `package.json#deprecated` triggers a yellow warning at every install, which feels heavy for a renamed-but-still-functional package. The banner is one line + only shown on actual scaffolder use. |
| 3 | **Same version line.** `create-rudder` releases mirror `create-rudder-app` versions one-to-one (changeset bumps both in lockstep). | Avoids "which one am I supposed to use?" confusion. Both are at the same version, both produce identical output, the choice is purely cosmetic. |
| 4 | **Stub package implementation: re-spawn via `npx create-rudder-app`** OR direct ESM import. Pick at implementation time based on what gives the cleanest argv passthrough. | The re-spawn approach is one line of `child_process.spawn(npxBin, ['create-rudder-app', ...process.argv.slice(2)], { stdio: 'inherit' })`. Direct ESM import requires `create-rudder-app` to export a `main()`. Re-spawn is simpler; direct import is faster (no second npx download). Decide when implementing. |

## Architecture

```
/Users/sleman/Projects/rudder/
├── create-rudder-app/         # source of truth — unchanged
│   ├── src/
│   ├── bin/index.mjs          # current entry
│   └── package.json
└── create-rudder/             # NEW — thin stub
    ├── bin/index.mjs          # delegates to create-rudder-app
    └── package.json           # name: 'create-rudder', dep: create-rudder-app
```

`create-rudder/bin/index.mjs` (re-spawn flavor — simplest first cut):

```js
#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Resolve the bin of the bundled dependency so we don't depend on npx.
const require = createRequire(import.meta.url)
const pkg     = require('create-rudder-app/package.json')
const binRel  = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin)[0]
const binAbs  = path.resolve(path.dirname(require.resolve('create-rudder-app/package.json')), binRel)

const child = spawn(process.execPath, [binAbs, ...process.argv.slice(2)], { stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 0))
```

`create-rudder/package.json` (sketch):

```json
{
  "name":        "create-rudder",
  "version":     "1.X.X",
  "description": "Scaffold a new Rudder framework app — `npm create rudder@latest`.",
  "type":        "module",
  "bin":         "./bin/index.mjs",
  "files":       ["bin"],
  "dependencies": { "create-rudder-app": "1.X.X" },
  "license":     "MIT"
}
```

## Surfaces to update

Per `feedback_provider_package_count_locations` — when something changes across multiple surfaces, list every one so future-me doesn't miss any:

1. **`README.md`** — Quick start install snippets (the pnpm/npm/yarn/bunx 4-line block, plus the "Adding packages later" tip if it mentions install).
2. **`docs/guide/installation.md`** (if it exists) — primary install instructions.
3. **`create-rudder-app/src/`** — the printed welcome / next-steps banner after a successful scaffold. Currently says "next: cd my-app && pnpm dev" type stuff; if it references the create command in any "to update later" hint, change it.
4. **`rudderjs.com` site:**
   - `src/components/rudder/blocks/Hero.tsx` or wherever the install pill renders (currently shows `npm create rudder-app@latest`)
   - `scripts/build-og-image.mjs` — the install command rendered into the OG image (`$ npm create rudder-app@latest`)
   - `app/Data/pages/home.ts` — any `installCmd` field
5. **Framework `CLAUDE.md`** — if the install command appears in code-search-able onboarding instructions.
6. **`create-rudder-app/src/`** banner emit (decision 2 above) — add the deprecation nudge here.

Quick checklist when implementing:
```
grep -rn "create rudder-app\|create-rudder-app@" \
  README.md docs/ create-rudder-app/src/ \
  ../rudderjs-com/src/ ../rudderjs-com/app/ ../rudderjs-com/scripts/
```

## Implementation work items

Single PR. Estimated effort: ~1.5 hours.

1. Create `create-rudder/` workspace with the stub package + bin.
2. Add to `pnpm-workspace.yaml` (the workspace config).
3. Add `create-rudder` to changesets so it auto-bumps with `create-rudder-app`.
4. Print the deprecation nudge in `create-rudder-app`'s entry point — single line before the welcome banner.
5. Sweep the 5 surfaces above to the new command form.
6. Test path: `pnpm pack` `create-rudder`, install in a tmp dir, confirm it spawns the scaffolder correctly.
7. Changeset entry covering both packages.

Then a parallel rudderjs-com PR for the site surfaces (#3 + parts of #4 in the list above) once the npm package is published.

## Risks

- **First publish race.** Until `create-rudder@1.X` is on npm, `npm create rudder@latest` returns 404. Users who try it before publish hit a confusing error. **Mitigation:** publish the stub first, then update marketing copy in a follow-up PR. Don't update the README until the install command actually works.
- **Stub-vs-source version drift.** If we publish `create-rudder-app@1.5.0` but forget `create-rudder@1.5.0`, the stub fails-loud (dependency unresolved). **Mitigation:** changeset config covers both; CI smoke runs the stub end-to-end.
- **PNPM workspace ambiguity.** Two packages in the workspace with similar names + one depending on the other could trip `pnpm install` resolution in edge cases. **Mitigation:** use `"create-rudder-app": "workspace:^"` in the stub's package.json so pnpm links during dev; at publish time changesets converts to the concrete version (per CLAUDE.md's `workspace:^` rule).
- **Deprecation banner noise.** If the banner is too loud, users on the old command get annoyed. **Mitigation:** one line, dim color, between the welcome banner and the first prompt. Not a yellow warning.

## Out of scope / follow-up

- **Rename `create-rudder-app/` workspace folder to `create-rudder/` and move the existing code there**, making the published `create-rudder-app` the stub instead. Cleaner end-state but bigger diff (history rewrite for git, all CI references, smoke test cells). Defer until the rename is bedded in via the stub approach.
- **Eventually unpublish `create-rudder-app`?** Probably never. The cost of leaving it published is ~zero; the cost of breaking every old blog post is high.
- **Vue/Nuxt-style cli shorthand** (`pnpm dlx rudder@latest`) — different shape, not in this plan.
- **`npx rudder` as an alternative invocation** — would require a published `rudder` package, conflicts with naming hygiene. Skip.
