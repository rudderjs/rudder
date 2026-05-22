# `rudder doctor` — `.env` check should be aware of `process.env`

**Status:** plan, 2026-05-23. Pickup task for the next framework session.
**Origin:** session 2026-05-23 in pilotiq-pro CI — wiring `rudder doctor` as a `predev` hook in the e2e workflow surfaced a false positive: doctor's `env:dotenv-loadable` check hard-fails when `.env` is *absent on disk*, even when every key the file would supply is already populated in `process.env`. Adjacent to (but non-overlapping with) the workspace-friendliness fixes in `2026-05-23-doctor-monorepo-friendliness.md`.

---

## Why this exists

The current `env:dotenv-loadable` check in `packages/cli/src/doctor/built-in/env-vars.ts:25-43` does this:

```ts
if (!fileExists('.env')) {
  return { status: 'error', message: 'missing', fix: 'Create a .env file …' }
}
```

That's right for the standard `pnpm dev` ergonomic — beginners coming from `cp .env.example .env` workflows get a clear, actionable error. But it's wrong for every *non-`.env`* deployment shape:

- **CI runners** — config arrives via GitHub Actions `env:` blocks, GitLab CI variables, etc. Nothing on disk.
- **Docker / compose** — `--env-file`, `environment:`, or secrets-mount. The `.env` file is on the host, never the container.
- **Forge / Fly / Render / Vercel / Railway** — the env-var panel writes to `process.env` directly. No file involved.
- **Kubernetes** — `ConfigMap` + `Secret` mounted as env. Same shape.

In all four, `process.env.APP_KEY` is properly set, `process.env.DATABASE_URL` is properly set, the app boots perfectly — but `rudder doctor` predev still red-flags the run because the *file* is missing. The other env checks (`env:app-key`, `env:app-env`, `orm-prisma:database-url`) already read from `process.env` and pass in those scenarios; only this one check treats the file as the canonical source.

### The concrete symptom that motivated the plan

In `pilotiq-pro/.github/workflows/e2e.yml`, the Playwright job runs `pnpm test`, which spawns `pnpm dev` via Playwright's `webServer` config. `pnpm dev` triggers `predev: rudder doctor`. Even after setting `APP_KEY` / `APP_ENV` / `DATABASE_URL` in the step's `env:` block:

```
✓ APP_KEY                     set, 32 bytes
✓ APP_ENV                     test
✓ DATABASE_URL                set (file)
✗ .env file                   missing
   fix: Create a .env file with your config (APP_KEY, AUTH_SECRET, etc.)
15 checks · 14 ok · 0 warn · 1 errors · 4ms
ELIFECYCLE Command failed with exit code 1.
```

Doctor exits non-zero → predev fails → dev server never starts → Playwright fails before a single test runs.

The current workaround in `pilotiq-pro` (shipped at `4f9f766`) is to `cat > .env <<EOF … EOF` before the test step, duplicating the env-var values that already exist in `process.env`. That works, but every consumer who hits this pattern will need the same workaround in their workflow.

## Goals

- `env:dotenv-loadable` returns `ok` (not `error`) when `.env` is missing on disk AND the canonical keys are present in `process.env`.
- The "starting a new project" UX is preserved: a bare clone with empty `process.env` still gets a clear, actionable error.
- The check name + id stay stable (no breaking change for `--only` callers).

## Non-goals

- Don't introduce a config flag to opt into this behavior — the right thing is automatic detection.
- Don't change the four sibling checks (`env:app-key`, `env:app-env`, `orm-prisma:database-url`, etc.) — they already read from `process.env` correctly. This plan covers the `.env` *file* check only.
- Don't add a "you're using process.env, here's how to align with .env conventions" lint. The user picked their deployment shape deliberately.

## Architecture

Single check, single file: `packages/cli/src/doctor/built-in/env-vars.ts`.

### What counts as "env config is supplied externally"

The strongest signal is **`process.env.APP_KEY`** being set. Reasoning:

- Every rudder app that needs `.env` needs `APP_KEY` (session / encryption / signed URLs). If `APP_KEY` is in `process.env`, the operator has demonstrably chosen the process.env shape.
- The existing `env:app-key` check uses the same key as its primary signal. Reusing it keeps the contract consistent.
- A demo / API-only app that doesn't need `APP_KEY` *and* has no `.env` is genuinely a fresh-clone case — the error fires correctly there. (And per `env:app-key`'s `appUsesAppKey()` heuristic, the matching APP_KEY error is downgraded to a warn.)

We could broaden to "any of APP_KEY / DATABASE_URL / APP_ENV", but that admits false negatives — a CI step that only sets `APP_ENV=test` would pass the check while leaving APP_KEY unset, which is exactly the problem the doctor is meant to surface. Sticking with APP_KEY keeps the heuristic precise.

### The diff

```ts
registerDoctorCheck({
  id:       'env:dotenv-loadable',
  category: 'env',
  title:    '.env file',
  run(): DoctorResult {
    if (!fileExists('.env')) {
      // Config can come from process.env directly — Docker, CI, Forge/Fly,
      // Kubernetes ConfigMap, etc. APP_KEY presence is the strongest signal
      // that the operator has deliberately chosen the process.env shape;
      // the sibling env:app-key check uses the same key as its primary read.
      if (process.env['APP_KEY']) {
        return {
          status:  'ok',
          message: 'absent — config supplied via process.env',
        }
      }
      const exampleHint = fileExists('.env.example')
        ? 'Run `cp .env.example .env` and fill in the secrets'
        : 'Create a .env file with your config (APP_KEY, AUTH_SECRET, etc.)'
      return { status: 'error', message: 'missing', fix: exampleHint }
    }
    // existing parse path unchanged
    const text = readFileSafe('.env')
    if (text === null) {
      return { status: 'error', message: 'present but unreadable', fix: 'Check file permissions on .env' }
    }
    const parsed = parseEnvText(text)
    return { status: 'ok', message: `parses (${parsed.size} keys)` }
  },
})
```

~6 net lines. Tested branches:

1. `.env` exists + parses → `ok, parses (N keys)` (unchanged).
2. `.env` exists + unreadable → `error, present but unreadable` (unchanged).
3. `.env` missing + `APP_KEY` set in env → **`ok, absent — config supplied via process.env`** (new).
4. `.env` missing + `APP_KEY` unset → `error, missing` (unchanged).

## Test plan

`packages/cli/src/doctor/built-in/env-vars.test.ts` (or wherever this check's tests already live — `grep -l env-vars packages/cli/src/doctor/`):

- **(a)** in a tmpdir with no `.env` file, set `process.env.APP_KEY` → expect `ok` + `message: 'absent — config supplied via process.env'`
- **(b)** in a tmpdir with no `.env` file, unset `process.env.APP_KEY` → expect `error` + `message: 'missing'` (regression guard)
- **(c)** in a tmpdir with a `.env` file containing `APP_KEY=…\nFOO=bar`, set or unset `process.env.APP_KEY` either way → expect `ok` + `message: 'parses (2 keys)'` (file branch is unchanged regardless of env state)

Restore `process.env.APP_KEY` after each case so test order doesn't matter.

## Out-of-band documentation note

Once shipped, add a one-liner to `packages/cli/README.md`'s doctor section: *"the `.env file` check passes when config is supplied via `process.env` directly (Docker, CI, Forge, etc.)"* — so operators stop wondering why CI works without a `.env` file.

## Risk

Low.

- Pure widening — every case that returned `error` before still returns `error` unless `APP_KEY` is genuinely populated in env, which itself is the success signal.
- No public-API change.
- No interaction with the `--only` filter (id stays `env:dotenv-loadable`).
- Composes cleanly with the workspace-friendliness fixes in `2026-05-23-doctor-monorepo-friendliness.md` — that plan touches different checks; this plan touches one.

## Effort

20-30 min: 6-line code change + 3 test cases + README note + changeset.
