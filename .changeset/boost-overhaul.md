---
"@rudderjs/boost": minor
"@rudderjs/ai": patch
"@rudderjs/auth": patch
"@rudderjs/mcp": patch
"@rudderjs/orm": patch
"@rudderjs/view": patch
---

**`@rudderjs/boost`** — overhauled the generated agent guidelines output.

Inspired by Laravel Boost's recent shape. Concrete changes:

- **`CLAUDE.md` is now ~135 lines, down from ~1,350.** Replaced the inline content dump of every package guideline with structured pointers to `.ai/guidelines/<package>.md`. The full per-package content still lives in `.ai/guidelines/` — agents load it on demand.
- **New structure** in `CLAUDE.md`: XML wrapper (`<rudderjs-boost-guidelines>`), `=== foundation rules ===` / `=== boost rules ===` / `=== skills activation ===` dividers, a Foundational Context section listing installed `@rudderjs/*` versions, a Boost MCP Tools section listing every exposed tool, and a Skills Activation section with explicit `**ACTIVATE when:** …` / `**SKIP when:** …` heuristics per skill.
- **Skill frontmatter enriched.** Each `SKILL.md` now declares `license`, `appliesTo`, `metadata.author`, plus the new `trigger` and `skip` fields that drive the CLAUDE.md activation section. `appliesTo` is the new filter — skills install only when at least one of their target packages is present (override with `--include-all-skills`).
- **Three skills modularized** into `SKILL.md` + `rules/*.md`:
  - `orm-models` (`@rudderjs/orm`) — split into 5 rule files (defining-models, querying, crud-and-observers, factories, resources).
  - `auth-setup` (`@rudderjs/auth`) — split into 5 rule files (provider-setup, guards-and-handlers, auth-views, gates-and-policies, email-and-password-reset).
  - `mcp-servers` (`@rudderjs/mcp`) — split into 5 rule files (tools, resources-and-prompts, server-assembly, transports, testing-and-di).
  - Each `SKILL.md` is now a compact Quick Reference (~40 lines) linking to the matching rule file. Rule files use paired Incorrect/Correct examples consistently.
- **`boost.json`** now records the active skill list under a `skills` field.

Migration: run `pnpm rudder boost:update` (or `boost:install`) to regenerate the new CLAUDE.md / boost.json / skill files. The old output is fully replaced — local edits to `CLAUDE.md` will be overwritten, same as before. Per-package guidelines and skills install paths are unchanged.

No API breaks. The `@rudderjs/*` package bumps are guideline / skill content changes for packages that ship `boost/` directories.
