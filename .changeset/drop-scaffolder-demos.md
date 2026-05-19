---
'create-rudder-app': minor
---

Drop the `/demos/*` scaffolder templates. The interactive flow already stopped
prompting for demos when recipes shipped (#519); the underlying template
fragments lingered as unreachable code reachable only by hand-constructing a
`TemplateContext` with `demos: [...]`. The smoke E2E was the last consumer.

What's gone:

- `create-rudder-app/src/templates/demos/` (18 files: contact, todos,
  polymorphic, fibonacci, system-info, avatar, pennant, cache, queue, mail,
  notifications, localization, http, ws, sync, index-view, registry,
  rudder-socket).
- Demo emitters in `routes/web.ts`, `routes/api.ts`, `app/service-provider.ts`,
  `prisma/schema/modules.prisma` (now just the empty `<rudderjs:modules:*>`
  markers).
- `<a href="/demos">Demos</a>` nav link in `SiteHeader` (all 6 framework × auth
  variants).
- The `demos` field on `TemplateContext` and `Answers`, plus `--demos`
  (was already a silent no-op).
- `shouldScaffoldDemo` / `shouldScaffoldAnyDemo` / `availableDemos` helpers.

Why: every demo lives in `playground/` already — that's where new framework
features get exercised. Keeping the templates in lockstep with playground was
manual work nobody was doing, and the scaffolder no longer surfaced them.

E2E coverage shape change:

The smoke profiles were rebuilt to mirror the user-facing recipes
(`minimal`, `web-app`, `saas`, `realtime`) instead of the synthetic
`default`/`todos`/`no-db`/`demos-all` profiles. The CI matrix is now an
include-based 8-cell shape:

- react × { minimal, web-app, saas, realtime } — 4 buildable recipes
- vue × { minimal, web-app } + solid × { minimal, web-app } — renderer drift

Net coverage gain: `saas` + `realtime` recipes now have E2E.

Two recipes are **deferred from the matrix** for a follow-up: **`api-service`**
AND **`minimal`** both have `needsFrontend: false` in `RECIPES`, which
resolves to `frameworks: []` at scaffold time. Vike's build plugin then
errors with `At least one page should be defined`, so the scaffold can't
`pnpm build`. Fixing it requires either a vanilla `pages/_error/+Page.ts`
template (returns plain HTML, no React/Vue/Solid imports) or skipping Vike
entirely when no frontend is selected. Both recipes stay in `RECIPES` so the
interactive picker still surfaces them, but the smoke won't exercise them
until a separate scaffolder PR lands the fix.

To keep a useful baseline in the matrix, the smoke's `minimal` cell diverges
from the user-facing `minimal` recipe: it uses `frameworks: ['react']` (no
packages, no ORM, but a buildable Welcome page) instead of the recipe's
`frameworks: []`. Comment in `scripts/smoke.ts:profiles.minimal` calls this
out.

Defensive correctness fix bundled here: `templates.ts` now gates every
`pages/` scaffold step on `frameworks.length >= 1` so a future recipe with
`frameworks: []` won't silently scaffold a `pages/index/+Page.tsx` it can't
build (the previous `if (frameworks.length === 1) ... else ...` shape
treated `[]` as multi-framework).
