---
'create-rudder-app': minor
---

Make the `minimal` and `api-service` recipes (the two `needsFrontend: false`
recipes) actually build. Previously, picking either through the interactive
picker or `--recipe=...` produced a scaffold that `pnpm build` couldn't
compile — Vike's plugin errors with `At least one page should be defined`
because `frameworks: []` skipped every `pages/` scaffold step.

How it's fixed:

- **Vanilla `app/Views/Welcome.ts`** — a no-React/Vue/Solid welcome view
  built with `@rudderjs/view`'s `html\`\`` tagged template (zero-client-JS,
  server-rendered string). `@rudderjs/vite`'s view scanner already supported
  vanilla mode: it detects no installed `vike-*` and generates the matching
  `pages/__view/welcome/+Page.ts` stub automatically. New
  `welcomeViewVanilla()` in `templates/views/welcome.ts`.
- **Vanilla `pages/+onRenderHtml.ts`** — Vike rejects `onRenderHtml`
  declared inline in `+config.ts` (`runtime in config` error), so the
  render hook lives in its own file. Wraps the page's body fragment in
  the document shell via `escapeInject` + `dangerouslySkipEscape` from
  `vike/server`. New `pagesRootRenderHtml()` in `templates/pages/index.ts`.
- **`pages/+config.ts`** for no-frontend stays minimal — just `passToClient`
  + the `Config` type. No `extends`, no `onRenderHtml` inline.
- **`routes/web.ts`** — welcome route fires for `frameworks.length <= 1`
  (single-framework OR no-frontend); multi-framework still uses
  `pages/index/+Page.*`.

E2E coverage:

The smoke matrix grows from 8 cells to 7 cells (api-service replaces
minimal in the vue/solid axis since minimal is no-frontend and the
framework override is a no-op for `frameworks: []`):

- react × { minimal, web-app, saas, api-service, realtime } — all 5 recipes
- vue / solid × { web-app } — renderer drift

Local verification:

- react/minimal — 2 routes (`/`, `/api/health`), ~12s
- react/api-service — 2 routes, ~17s
- react/web-app — 4 routes + flow-check, ~25s (regression check)
- Workspace typecheck + lint clean, 210 scaffolder tests pass.

The `minimal` profile in the smoke now mirrors the actual recipe shape
(`frameworks: []`) — no more divergence between what users get and what
CI tests.
