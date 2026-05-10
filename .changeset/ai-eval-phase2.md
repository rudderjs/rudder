---
"@rudderjs/ai": minor
"@rudderjs/cli": patch
---

**A5 Phase 2 — `pnpm rudder ai:eval` CLI + JSON reporter.** Phase 1 shipped the eval framework; Phase 2 makes it a first-class command. The CLI walks `evals/**/*.eval.ts` (override via `config('ai').eval.pattern`), runs each suite serially, and reports pass/fail + cost + tokens.

- **Console mode** (default) — uses Phase 1's `reportConsole` per suite.
- **`--json`** — emits a `{ suites: [{ suite, passed, failed, cases: [{ name, status, pass, score?, reason?, tokens, cost, duration }] }] }` envelope to stdout. CI scripts can pipe directly into `jq`; matches the `command_run` MCP tool envelope shape so the boost agent surface and the eval CLI feel like one family.
- **`--bail`** — stop on the first failing suite. Pairs with `--json` so a failing CI run streams the first failure without waiting for the rest.
- **Positional name filter** — `pnpm rudder ai:eval support` runs only suites whose `name` includes `'support'` (case-insensitive substring).

Exits 0 when every case passes, 1 otherwise (also 1 when no suites match in console mode; `--json` always exits 0 with an empty envelope so `jq` consumers don't crash).

Phase 3 adds `jsonShape`/`semanticMatch`/`tokenCost` metrics; Phase 4 adds `--record`/`--replay` (AiFake-backed) + telescope `agent.eval.completed` events; Phase 5 adds the HTML report.
