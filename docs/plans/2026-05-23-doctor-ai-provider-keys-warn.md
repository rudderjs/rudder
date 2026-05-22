# `rudder doctor` — `ai:provider-keys` should warn (not error) when all keys missing

**Status:** plan, 2026-05-23. Pickup task for the next framework session.
**Origin:** session 2026-05-23 in pilotiq-pro CI — bumping `@rudderjs/ai` 1.5.0 → 1.8.2 surfaced the new `ai:provider-keys` doctor check shipped in 1.8.0. The check hard-errors when *every* declared cloud provider is missing its API key, which blocks `predev` in CI / smoke / no-AI-test environments where the app boots fine but the operator has deliberately not wired keys yet. Sibling concern to `2026-05-23-doctor-dotenv-process-env-aware.md` — same pattern of `predev` over-strictness on a runtime-only condition.

---

## Why this exists

The current check (`packages/ai/src/doctor.ts:35-66`) does:

| state | severity |
|---|---|
| no `config/ai.ts` / no providers declared | ok |
| all declared providers are local (ollama / lmstudio) | ok |
| **all declared cloud providers missing keys** | **error** |
| some cloud providers missing keys | warn |
| all cloud provider keys present | ok |

The middle row is the over-strict one. Reasoning:

1. **The app boots fine without AI keys.** The check is a *runtime intent* check, not a *boot* check — failures only surface when an AI call is actually invoked (401 from the provider). That's a different surface concern than the `predev` gate.
2. **Asymmetric with the "some missing" branch.** Missing-some is arguably the *more* dangerous state — partial config can mask "should work" runs that fail intermittently. Both branches should share severity.
3. **Forces fake keys in CI.** pilotiq-pro's e2e workflow now writes `ANTHROPIC_API_KEY=sk-ant-test-not-a-real-key` to its test `.env` purely to pass the predev gate. None of the e2e specs exercise real AI calls — keys are noise. Every consumer who hits this pattern will need the same workaround.
4. **Mirrors `env:app-key` post-#619.** When no provider in the boot graph consumes `APP_KEY`, the check downgrades to warn. The doctor's design ethos: error on "the app won't boot at all," warn on "the app boots but a runtime path will fail later." `ai:provider-keys` is squarely the latter category — declaring `driver: 'anthropic'` in `config/ai.ts` doesn't even ensure that provider is *wired* in `bootstrap/providers.ts`.

## Goals

- `ai:provider-keys` with all keys missing emits **warn** (not error), so `predev` exits 0.
- The fix-text stays actionable (still suggests setting one of the env vars).
- Per-provider visibility preserved (the message still says which providers are configured + which are missing).

## Non-goals

- Don't gate on `APP_ENV=test` / `CI=true` — too narrow, and the user-facing behavior should be the same in any env (the message still tells the operator something is unset; severity just shouldn't block predev).
- Don't add a "is `@rudderjs/ai` actually wired in providers.ts?" deep-check — the existing `config/ai.ts` grep is good enough for the severity decision. Mirror the pattern from `env:app-key` only conceptually, not literally.
- Don't change the "some missing" warn behavior — it stays as is.

## Architecture

Single-file change: `packages/ai/src/doctor.ts:49`.

```ts
// Before:
if (missing.length === needsKey.length) {
  return {
    status:  'error',
    message: `none of ${needsKey.length} cloud provider(s) have an API key set`,
    fix:     `Set at least one of: ${needsKey.map(p => PROVIDER_ENV[p]).join(', ')}`,
    detail:  `Declared providers: ${needsKey.join(', ')}`,
  }
}

// After:
if (missing.length === needsKey.length) {
  return {
    status:  'warn',
    message: `none of ${needsKey.length} cloud provider(s) have an API key set`,
    fix:     `Set at least one of: ${needsKey.map(p => PROVIDER_ENV[p]).join(', ')} (or remove the providers from config/ai.ts if unused)`,
    detail:  `Declared providers: ${needsKey.join(', ')}`,
  }
}
```

Two-character status change + one extra clause in the fix-text (the same parenthetical the "some missing" branch already uses — keeps the two branches consistent).

## Test plan

`packages/ai/src/doctor.test.ts` (or wherever the existing tests live):

- **(a)** `config/ai.ts` declares `driver: 'anthropic'`, no env keys set → status `warn`, message mentions "1 cloud provider(s)" (regression for the severity flip)
- **(b)** `config/ai.ts` declares anthropic + openai + google, no env keys → status `warn`, fix-text lists all 3 env vars
- **(c)** `config/ai.ts` declares anthropic + openai, `ANTHROPIC_API_KEY` set, `OPENAI_API_KEY` unset → status `warn` (unchanged), message mentions "1/2"
- **(d)** `config/ai.ts` declares anthropic + openai, both keys set → status `ok` (regression guard)
- **(e)** no `config/ai.ts` → status `ok` (unchanged)
- **(f)** `config/ai.ts` declares only `driver: 'ollama'` → status `ok` (unchanged — all local)

## Out-of-band documentation note

Once shipped, add a one-liner to `packages/ai/README.md`'s doctor / setup section: *"the `ai:provider-keys` check warns (not errors) when no keys are set — the app boots fine; AI calls will 401 if invoked without keys. Set the relevant env var when you're ready to enable AI features."*

## Composes with

- **`2026-05-23-doctor-dotenv-process-env-aware.md`** — different check, same theme (`predev` shouldn't hard-error on runtime-intent conditions when the app boots fine). Independent file changes; no overlap.
- **#619** workspace-friendliness fixes — also independent.
- **`2026-05-23-doctor-monorepo-friendliness.md`** — independent.

## Risk

Low.

- Pure severity widening — every case that returned `error` before now returns `warn` with the same message; nothing fails-closed becomes fails-open.
- No public-API change.
- Doesn't change the `--only ai` filter behavior (id stays `ai:provider-keys`).
- Doesn't interact with provider-registration / boot.

## Effort

15-20 min: ~3-line code change + 6 test cases (5 may already exist as ok/warn assertions to tweak) + changeset.
