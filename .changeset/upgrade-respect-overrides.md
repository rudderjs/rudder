---
"@rudderjs/cli": minor
---

`rudder upgrade` now reconciles `@rudderjs/*` version pins in package-manager **overrides**, fixing the silent partial upgrade reported in #1089.

Previously the command rewrote only the `@rudderjs/*` ranges in `package.json`. In a repo that pins the rudder train via `pnpm-workspace.yaml > overrides` (or `package.json > pnpm.overrides` / `resolutions`), those pins win at install time, so only the unpinned packages actually moved — `package.json` ended up disagreeing with what was installed and sibling-version checks broke.

Now `upgrade`:

- Detects `@rudderjs/*` pins across all three override sources, reading them from the workspace root (walked up from the cwd) so it works when run inside a member package.
- Bumps each pinned package in lockstep with the target version — including transitive siblings that aren't direct dependencies — preserving the original operator prefix (`^`/`~`/exact). `pnpm-workspace.yaml` is rewritten with a surgical line replace that keeps comments and formatting; `pnpm.overrides` / `resolutions` are updated in `package.json`.
- Shows the override bumps in the plan, counts them in `--check` / `--dry-run`, and warns (instead of silently skipping) for any pin it can't locate to rewrite.
