---
"create-rudder-app": patch
---

docs: full sweep — scaffolder refresh + monitoring graduation + broken examples

Brings 8 docs back into agreement with the post-Phase-6 / 1.0-graduation
state. First three are the scaffolder refresh, next three are real
copy-paste-broken examples uncovered while sweeping, last two are the
roadmap/architecture status updates that lagged the recent monitoring work:

- **create-rudder-app/README.md** — prompts table updated (10 steps with
  conditional Demos step); package checklist rewritten as 8 categories /
  25 rows (sanctum, socialite, image, http, process, concurrency, pulse,
  horizon, crypt, pennant, cashier-paddle added; Demos row removed since
  it's a separate prompt now); generated structure refreshed
  (`app/Http/`, MCP `EchoTool.ts`, demo support classes, `RudderSocket.ts`,
  `lang/`; `RequestIdMiddleware` removed); demos table covers all 14;
  smoke section lists all 4 profiles; test count `111 → 169`; new
  troubleshooting entry for the AES-256 32-byte appKey requirement.
- **claude-notes/create-app.md** — full rewrite for the cascade-aware
  prompt flow, Tier A silent install, demos registry as single source of
  truth (incl. `create-rudder-app/demos-registry` subpath export), Phase 1
  module split layout, smoke profile catalogue, fresh-worktree Prisma
  generate gotcha. The previous version still mentioned `BKSocket`,
  `Live.tsx`, the dropped Todo-module prompt, and the pre-cascade flat
  package list.
- **CLAUDE.md** — graduation status line updated (every `@rudderjs/*`
  package on npm is 1.0.0+ as of 2026-05-02); playground tree expanded
  to show the current `app/` directories (Http, Jobs, Mail, Notifications,
  Services, Commands, Events, Exceptions) and the Demos view directory.
- **README.md (root)** — Events example used non-existent `events({...})`
  import → `eventsProvider({...})` with class refs (not instances) matching
  playground; broadcasting client snippet referenced the old `BKSocket` →
  `RudderSocket` (file/class renamed in PR #183); package count typo
  (heading "46", body "45" — both should say 46, verified by counting
  `packages/`).
- **docs/guide/broadcasting.md** — six `BKSocket` references → `RudderSocket`.
  Vendor-publish destination path was also wrong: `src/lib/BKSocket.ts` →
  `src/RudderSocket.ts` (the command copies from the package's `client/`
  dir to the project's `src/`, not `src/lib/`).
- **docs/guide/events.md** — "Using the dispatcher directly" code block
  imported a non-existent `events` export and called `events()` as a
  function with non-existent method `has()`. Real API is the `dispatcher`
  singleton with `hasListeners()`. This example would not type-check or
  run as written.
- **ROADMAP.md** — last-updated date `2026-04-20 → 2026-05-03`. Plan 7.1
  (Pulse) and 7.3 (Horizon) flipped from `⬜ untested` to `✅` — both
  shipped at 1.0+ and browser-verified end-to-end through the
  cross-process queue collector saga (#144 / #146 / #149 / #151 / #153 /
  #156 / #158 / #160). Plan 7 Deliverables refreshed with concrete shipped
  feature counts (telescope's 19 collectors with overlap/divergence vs
  Laravel's 18, pulse's 7 aggregators, horizon's lifecycle scope).
  Execution order phase 6 status `partial → mostly done`. New Packages
  Summary pulse/horizon entries flipped to ✅.
- **Architecture.md** — `packages/rudder/` → `packages/console/` (renamed
  in PR #97, line was the only stale ref left); scaffolder prompts
  description updated to the cascade flow + demos registry; bootstrap
  providers.ts example replaced manual provider list with the canonical
  `defaultProviders()` pattern (matches CLAUDE.md, README, scaffolder
  output) + a paragraph explaining the auto-discovery flow + opt-out
  paths; Roadmap Status table Plan 7 row updated to reflect Pulse +
  Horizon shipped (was "Telescope ✅, Pulse ⬜ untested, Horizon ⬜ untested").

After this lands, sync rudderjs-com `/docs` (per the project's standard
4-step sweep) — broadcasting.md and events.md changes propagate.
