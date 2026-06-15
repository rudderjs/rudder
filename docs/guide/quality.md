# Quality

Rudder is young — every package graduated to 1.0 on 2026-05-02. A "1.0" badge means nothing on its own, so this page describes exactly how the framework is tested and released, with enough detail that you can verify the claims yourself rather than take them on faith.

For *writing* tests in your own app, see [Testing](/guide/testing). This page is about how Rudder tests itself.

## What "tested" means here

Every public API has unit tests, and every user-facing flow has at least one end-to-end test that boots a real application. Tests run on Node's built-in `node:test` runner (no Jest/Vitest in the framework itself) and Playwright for browser-level E2E. There is no separate "examples" codebase that drifts from reality — the playground apps that the E2E suites drive are the same ones used to develop features.

Two things deliberately are *not* claimed:

- **A headline coverage percentage.** Coverage numbers are easy to game and say little about edge-case quality. What matters is that the API surface and the scaffolded-app flows are exercised, which the CI jobs below enforce.
- **Tested on every runtime.** Rudder exposes a [WinterCG Fetch handler](https://wintercg.org/) and *runs* on Node, Bun, Deno, and Cloudflare Workers — but CI gates on Node (22 and 24) across Linux and Windows. Treat non-Node runtimes as supported-and-spot-checked, not continuously gated.

## Continuous integration

Every pull request to `main` runs the following before it can merge ([`.github/workflows/ci.yml`](https://github.com/rudderjs/rudder/blob/main/.github/workflows/ci.yml)):

| Job | What it does |
|---|---|
| **Lint** | ESLint across every package's `src`. |
| **Build & Test** | `turbo run build` + `turbo run test` for all packages and the scaffolder, on a matrix of **Ubuntu + Windows × Node 22 + 24**. |
| **Docs Build** | Builds this VitePress site — catches broken Markdown and dead internal links at PR time. Runs on docs-only PRs too. |
| **Scaffolder E2E** | Scaffolds fresh projects, installs, builds, boots them, and drives a headless browser to render-check the result. See below. |
| **RSC E2E** | Builds the React Server Components playground for production and drives a browser through an SSR render plus a `"use server"` action round-trip. |

Docs-only changes skip the heavy jobs (a leading `changes` job detects whether any non-docs file was touched), so a typo fix doesn't burn 20 minutes of matrix time — but the docs build still runs.

## Scaffolder end-to-end

The strongest signal that the framework works is that a freshly scaffolded app works. The Scaffolder E2E matrix doesn't test internal units — it runs the exact path a new user takes:

1. Scaffold a project with `create-rudder` (every recipe: `minimal`, `web-app`, `saas`, `api-service`, `realtime`).
2. Install dependencies and run a production build.
3. Boot the built server.
4. Drive a real browser (Playwright) against it and assert the pages render.

The `react × web-app` cell goes further and walks the full **register → home → sign-out** flow, so auth, sessions, the ORM, and SSR are all exercised end-to-end in one test. Vue and Solid get a `web-app` render-check; the CLI entrypoint and the `npm` package manager each get a dedicated cell so package-manager-specific regressions surface in CI rather than in your terminal.

## Weekly npm canary

The per-PR matrix points dependencies at the local workspace, so it can't catch a release that published one package but left a peer constraint pointing at a version that isn't on npm yet. A separate weekly job ([`scaffolder-canary.yml`](https://github.com/rudderjs/rudder/blob/main/.github/workflows/scaffolder-canary.yml)) closes that gap:

- Runs `pnpm create rudder-app` against the **published** packages on npm — `latest`, not workspace links.
- Builds the production bundle and boots the server.
- Hits `/`, `/api/health`, and `/login`.

If a release left the published set inconsistent, this goes red within a day — not after a user files a bug.

## Releases

Versioning is managed with [Changesets](https://github.com/changesets/changesets). Each package versions independently, every user-affecting change ships with a changeset describing it, and `CHANGELOG.md` entries are generated from those — so the changelog reflects what actually changed, not a hand-curated summary. Releases are reproducible: the same `pnpm install --frozen-lockfile` + build runs in CI and at publish time.

## Verify it yourself

- **CI runs** — every PR's checks are public: [github.com/rudderjs/rudder/actions](https://github.com/rudderjs/rudder/actions)
- **Release history** — per-package changelogs and tags: [github.com/rudderjs/rudder/releases](https://github.com/rudderjs/rudder/releases)
- **The workflows** — read the gates above as source: [`.github/workflows/`](https://github.com/rudderjs/rudder/tree/main/.github/workflows)

If something here doesn't match what you find, that's a bug in this page — [open an issue](https://github.com/rudderjs/rudder/issues).
