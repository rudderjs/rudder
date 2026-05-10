---
"@rudderjs/ai": minor
---

**A5 Phase 5 — HTML report + suite metadata.** Closes out the eval framework roadmap.

- **`pnpm rudder ai:eval --html <path>`** writes a self-contained HTML report to the given path. Inline CSS, minimal vanilla JS for row expand/collapse — no framework, no external assets. Pasteable into PR comments / Slack threads, openable offline. Coexists with `--json` (JSON still goes to stdout, HTML goes to disk). Defaults `path` resolution to the app cwd; intermediate directories are created.
- **`evalSuite('Name', { ..., metadata: { owner, lastReviewed, ticket } })`** — optional ownership / context, surfaced in the HTML report header. Open shape (`[k: string]: string | undefined`) so teams can attach custom keys; the report renders `camelCase` → `Title Case` for the well-known `lastReviewed` and passes others through verbatim.
- **`reportHtml(reports, opts?)`** — pure function exported from `@rudderjs/ai/eval` for programmatic use (e.g. emitting a report from a custom CI script). Defensive HTML-escape on every piece of user content (suite/case names, input, response, metadata, reasons).
- **`CaseResult.input`** is now always populated; **`CaseResult.responseText`** is set when the agent produced a response (omitted when the agent threw or the case was skipped). Threads through `runSuite` so reporters and external tooling can render the prompt + response alongside pass/fail.
- **`SuiteReport.metadata`** copies through from the spec when set so reporters can pick it up without re-reading the suite definition.

Phase 5 is the last A5 phase. The remaining surface — `--check-fixtures` for catching non-deterministic agents, the telescope dashboard "Evals" tab — lives outside the framework.
