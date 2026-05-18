# CI portability matrix — Windows + Node version matrix + scaffolder E2E

**Status:** plan, 2026-05-18. Pickup task for a fresh session.
**Precedent / inspiration:** Vike upstream CI (`vike-upstream/.github/workflows/ci.yml` + `prepare.ts`).

---

## Why this exists

Today's CI (`.github/workflows/ci.yml`) runs one `build-test` job on Ubuntu + Node 22. That misses three classes of bugs that real users will hit:

1. **Windows path bugs.** A lot of Rudder is path-sensitive — the Vite scanner (views, routes), the provider manifest, the CLI scaffolders, every `make:*` command, the view id → URL mapper. Path separators on Windows differ; we have *zero* CI coverage there today. This is the lever Vike actually leans on (their matrix is Ubuntu + Windows, no macOS).
2. **Node version drift.** We've already hit Node-22-specific quirks (`mock.module()` keying by `file://`, see `feedback_node_mock_module_gotchas.md`). We have multiple `globalThis` singletons, ESM-only optional peer resolution (`resolveOptionalPeer`), and dynamic-import patterns that could behave differently on Node 20 (current LTS) vs 22 vs 24. We implicitly claim LTS support — CI doesn't back it.
3. **Scaffolder/template drift.** Our 141 unit tests run *inside* each package against compiled `dist/`. Nothing exercises the actual user-facing flow: `pnpm create rudder-app` → `pnpm install` → `pnpm build` → `pnpm dev` → hit `/`. This is the path users boot through; bugs that show up only at first-boot of a generated app (missing exports condition, peer not installed, provider manifest missing, template renaming drift) slip past today's tests.

## Goals

- Add Windows runner coverage to catch path/separator bugs at PR time.
- Add Node 20 + 22 matrix (single source of truth, no duplicated YAML) to back the LTS support claim.
- Add a scaffolder E2E job that boots a real generated app and asserts it serves a request.
- Keep CI wall-clock under ~10 minutes on a green run. Parallel jobs, not serial.

## Non-goals

- **Not** copying Vike's 20-job matrix. Their job count is sized to their 50+ example apps; we don't have that surface. The relevant ideas from Vike are *which axes* to vary (OS + Node), not *how many* permutations.
- **Not** adding macOS. Linux and macOS behave the same for our code; the marginal value is below the runner-minute cost.
- **Not** adding Cloudflare / Vercel / edge-runtime jobs. We don't have an explicit edge story to test against — revisit when we do.
- **Not** turning unit tests into Playwright E2Es. The scaffolder E2E is one specific smoke (boots + serves), not a UI test suite.
- **Not** matrix-splitting per package. Turbo parallelizes within a job; adding GHA splits only multiplies the per-job pnpm-install/build overhead.

## Phases

### Phase 1 — OS + Node matrix on the existing build-test job

**Change:** Convert `build-test` in `.github/workflows/ci.yml` into a matrix job over `os` ∈ {`ubuntu-latest`, `windows-latest`} × `node-version` ∈ {`20`, `22`}, with `fail-fast: false` so one Windows-only failure doesn't kill the Ubuntu run.

**Shape:**

```yaml
build-test:
  name: Build & Test (${{ matrix.os }}, Node ${{ matrix.node-version }})
  runs-on: ${{ matrix.os }}
  strategy:
    fail-fast: false
    matrix:
      os: [ubuntu-latest, windows-latest]
      node-version: ['20', '22']
  timeout-minutes: 20
  # ... existing steps
```

**Things to verify before this is green:**

- `pnpm turbo run build` works on Windows. Watch for any package whose build script shells out with POSIX-only syntax (`&&` chains and `set` env vars are usually fine; backticks, `$()`, and inline globs may not be).
- `pnpm turbo run test` works on Windows. Node's test runner is cross-platform; the risk surface is test fixtures with hardcoded `/` separators or `file://` URL construction. Grep for `path.join` vs `path.posix.join` mismatches.
- `pnpm rudder providers:discover` (run as part of any prebuild) reads `package.json` `rudderjs` field — does it normalize `\\` vs `/` in the cached path? Check `packages/cli/src/commands/providers-discover.ts`.
- Vite scanner output (`pages/__view/registry.d.ts`, route registry) — paths are platform-normalized. If the scanner writes Windows `\\` separators into a `.d.ts` file, that file becomes invalid TS. Should already be POSIX-normalized; verify.
- `node:test` on Node 20: confirm tests that use `mock.module()` work. Per `feedback_node_mock_module_gotchas.md`, the script needs `--experimental-test-module-mocks`. Node 20 supports the flag from 20.6+; pin matrix to `20` (latest 20.x) not `20.0.0`.

**Expected failures and how to handle them:**

- *First Windows run will probably fail somewhere we don't expect.* Don't speculate-fix in this phase — bisect to the failing test, fix the specific path issue, push. Repeat until green. Do not add Windows-skip annotations as a shortcut.
- *Node 20 may fail on `mock.module()` tests* in mail/queue/broadcast (anywhere using the gotchas pattern). If those tests need a higher minor, document the floor in the package's `engines` and bump the matrix Node version, not the other way around.
- *Drizzle / Prisma native binding issues on Windows*: Prisma works on Windows; Drizzle better-sqlite3 needs the right prebuilt binary. If the test that uses it is in `@rudderjs/orm-drizzle`, it may fail to install on Windows — gate the relevant test file with `process.platform !== 'win32'` only if necessary, and file an issue.

**Cost:** 1 job → 4 jobs. With turbo cache hits the marginal cost is the pnpm install + setup-node × 3 extra. Expect ~5–7 min per matrix cell; runs in parallel.

### Phase 2 — Scaffolder E2E job

**Change:** Add a new job `scaffolder-e2e` (Ubuntu only, Node 22 only — keep it cheap). Runs once per CI invocation.

**Steps:**

1. Build all packages (reuse turbo cache from Phase 1 if possible — see "Caching" below).
2. `pnpm pack` every `@rudderjs/*` package + `create-rudder-app` into a temp directory.
3. Set up a pnpm registry override (`.npmrc` with `@rudderjs:registry=file:...` via [verdaccio](https://verdaccio.org/) or pnpm's `link:` protocol against the tarball directory).
4. In a temp working dir outside the monorepo: `pnpm create @rudderjs my-app --template react-default --install` (or whatever the React-only template flag becomes).
5. `cd my-app && pnpm build`.
6. `pnpm start` (or `node dist/server/index.mjs`) in the background.
7. Curl `http://localhost:3000/` and assert 200 + the Welcome page HTML contains a known marker (e.g. `Rudder` or `Welcome`).
8. Kill the server, exit clean.

**Why a separate job, not part of build-test:**

- The scaffolder E2E needs the full `pnpm build` + a publishable form of every package + a fresh out-of-monorepo install. That's a different shape from "unit tests in dist/".
- It runs once; doesn't need the OS/Node matrix yet (add later if the smoke is stable).
- Failures here are *user-facing* — they should block the PR, but they're a different signal from "a unit test regressed".

**Caching:** `pnpm pack` outputs are deterministic per content. We can cache the tarball dir keyed by `pnpm-lock.yaml` hash + the diff of `packages/*/src/**` (rough — `git rev-parse HEAD:packages` is fine for now). Don't over-engineer caching in phase 2; first make it work green.

**What it catches:**

- Missing `exports` conditions (already burned by this — see `feedback_esm_only_peer_require_bug.md`).
- Scaffolder template drift (a file referenced in `bootstrap/app.ts` no longer exists in the template).
- Provider auto-discovery breakage (manifest write fails, or the manifest references a missing package).
- A new dep not declared in `create-rudder-app`'s template `package.json`.
- A package's `boot()` crashing on first boot because of an env var assumption (we have at least one case in memory — `project_ai_provider_eager_key_check.md`).
- Vite scanner output is invalid (the `+route.ts` files don't compile, or pageContext fetch fails).

**Open questions to answer in implementation:**

- Which template to default to? Recommend `react-default` (matches the public docs flow and the most-used path).
- Do we need a DB step? Probably not for v1 — the Welcome page renders without DB. The auth flow needs DB; defer auth E2E to a later phase.
- How do we surface a useful error if the server fails to start? Capture both stdout and stderr to a log file; print on failure. Use a 15-second timeout for the boot wait.

**Cost:** ~3–4 min. One extra job.

### Phase 3 — (deferred) Scaffolder E2E variants

After phase 2 is stable for a few weeks, add:

- Vue template, Solid template (one job each, behind matrix axis).
- One template with auth + DB (sqlite) wired in — boot, register a user, log in, hit `/dashboard`, assert 200.
- Windows for the React template (catches Windows-specific scaffolder bugs like backslash paths in generated source files).

Don't ship Phase 3 in the same PR as Phase 2. Each adds runtime and surface area; verify Phase 2 is reliable first.

## Risks

- **Windows runner minutes are 2× Linux.** GHA Free for OSS is generous; private repos count private minutes. We're public — verify.
- **First Windows run will probably have a real failure** in code that's been broken on Windows the whole time but nobody noticed. Treat as in-scope for the PR shipping Phase 1; don't merge with red.
- **Node 20 floor:** if a test needs Node 22 features and we can't reasonably backport, the answer is "drop Node 20 from the matrix and document the engines requirement", not "skip the test on 20".
- **Scaffolder E2E flake:** background server startup is timing-sensitive. Use a real readiness probe (curl `/` until 200, max 15s), not `sleep`. Vike's approach is the same — `@brillout/test-e2e` polls for readiness.
- **Caching cliff:** Turbo cache is local to a runner OS+arch. A Windows runner won't reuse an Ubuntu cache key. That's expected; budget for it in the wall-clock estimate.

## Success criteria

- A PR that breaks Windows path handling fails CI on the Windows matrix cell, not silently merges.
- A PR that bumps a dep and breaks `pnpm create rudder-app` fails the `scaffolder-e2e` job, before users hit it.
- A PR that uses a Node-22-only API without bumping `engines.node` fails the Node 20 matrix cell.
- Total CI wall-clock for a green main-branch PR stays under ~10 min.
- No new "test skipped on Windows" lines added to bypass real bugs.

## Sequencing

Ship Phase 1 first as one PR. Get it green on `main`, watch it for a few PRs to make sure it's not flaky. Then ship Phase 2 as a second PR. Phase 3 is a separate session.

**Not load-bearing for any open PR / customer issue** — this is hardening, not a fix. Schedule when there's a calm window; don't interleave with a perf or feature session.

## Out-of-scope follow-ups (don't ship in this plan)

- macOS runners.
- Edge runtime / Cloudflare Workers test matrix.
- Per-package job split (turbo handles parallelism).
- Playwright UI tests for the playground (separate plan if we want it).
- Bench-in-CI (separate concern; perf benches don't belong on every PR).
