---
'@rudderjs/cli': minor
---

`rudder upgrade` — CHANGELOG snippets inline.

For every package being bumped, the command now fetches the `CHANGELOG.md` from the framework's public GitHub repo (npm tarballs intentionally omit it via `files: ["dist"]`), parses every `## X.Y.Z` section in the window between current and target, and prints a one-line headline per intermediate version:

```
  @rudderjs/cli  4.6.5 → 4.7.1  (devDependencies)
      4.7.1  rudder upgrade — handle floating dist-tag ranges
      4.7.0  rudder upgrade — one-step bump of every @rudderjs/* dep to latest
      4.6.9  stripInternal: true is now set in tsconfig.base.json
      ...
```

Headlines come from the first non-trivial bullet of each version's changeset entry; the cite-prefix (`abc1234:`) is stripped and `Updated dependencies [...]` lines are skipped.

New flags:

- `--no-changelog` — skip the fetch entirely (faster, quieter; useful for CI).
- `--changelog-base <url>` — override the GitHub raw base URL (forks, mirrors). Default: `https://raw.githubusercontent.com/rudderjs/rudder/main`.

Fetch failures degrade gracefully — a row whose CHANGELOG can't be fetched renders without the indented detail block.

`parseChangelog()` + `collectChangelogs()` are exported with a pluggable fetcher so unit tests drive them with synthetic markdown, zero network in CI.
