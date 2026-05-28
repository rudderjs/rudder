---
'@rudderjs/cli': minor
---

`rudder upgrade` — one-step bump of every `@rudderjs/*` dep to the latest published version.

```bash
pnpm rudder upgrade            # bump everything to latest
pnpm rudder upgrade --check    # CI gate: exit 1 if updates available, no changes
pnpm rudder upgrade --dry-run  # preview without modifying
pnpm rudder upgrade --minor    # cap within current major (no breaking changes)
pnpm rudder upgrade --patch    # cap within current minor (bug fixes only)
```

Finds every `@rudderjs/*` package across `dependencies`, `devDependencies`, and `peerDependencies`. Queries the npm registry for each one's `latest` dist-tag. Rewrites `package.json` with new caret ranges, then runs your package manager's install (auto-detected from the lockfile — pnpm / npm / yarn / bun).

Major bumps are highlighted red in the plan so reviewers can spot breaking-change risk before applying. Per-package CHANGELOG snippets and a `doctor` integration are queued for later releases — see `docs/guide/installation.md#keeping-up-to-date` for the current flag list.

Workspace refs (`workspace:*`) are skipped with a clear "couldn't parse" notice — the command is intended for downstream apps, not the framework monorepo itself.
