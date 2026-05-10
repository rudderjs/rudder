---
"@rudderjs/ai": minor
---

**A5 Phase 4 — `--record` / `--replay` + `agent.eval.completed` observer event.** Deterministic regression tests for AI agents and a hook for telescope dashboards.

- **`pnpm rudder ai:eval --record [name-filter]`** runs each case against the real provider and writes the assistant turns to `evals/__fixtures__/<suite>/<case>.json`. Existing fixtures are overwritten — diff in your VCS to see what changed.
- **`pnpm rudder ai:eval --replay [name-filter]`** swaps the runtime with `AiFake.fake()` and feeds each case its recorded fixture via `respondWithSequence`. Zero API calls, zero cost, deterministic. Cases without a fixture fall through to a normal run with a stderr warning. `--record` and `--replay` are mutually exclusive.
- **`agent.eval.completed`** AiEvent variant (`{ kind, suite, case, status, pass, score?, reason?, tokens, cost, duration }`) emits after each case completes — including skipped cases, so dashboards can surface coverage gaps. Telescope's AI collector will land an "Evals" tab in a follow-up to aggregate pass-rate per `(suite, case)` over time.
- **`stepsFromResponse(response)`** + `EvalFixture` type re-exported from `@rudderjs/ai/eval` so external tooling (custom CI scripts, alternative replay engines) can compose without duplicating the extraction logic.

**Fixture format** is versioned (`version: 1`); reading a future-versioned fixture throws to force re-record rather than silently mis-replay. Suite/case names are slugified for filesystem safety (non-`[A-Za-z0-9._-]` collapses to `-`).

**Internal:** record/replay are implemented as a per-case `agent`/`assert` decoration — the `runSuite` runner stays unchanged. Replay pre-loads every fixture for a suite up-front so the per-case factory can prime `AiFake.respondWithSequence` synchronously.

**Out of scope (deferred to follow-ups):** `--check-fixtures` flag for catching non-deterministic agents, the telescope dashboard "Evals" tab, and Phase 5's HTML report.
