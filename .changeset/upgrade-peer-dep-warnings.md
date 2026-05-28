---
'@rudderjs/cli': minor
---

`rudder upgrade` — detect peer-dependency mismatches.

After building the bump plan, the command now fetches each upgraded `@rudderjs/*` package's `peerDependencies` at the target version and diffs them against the peers declared in the consumer's `package.json`. When a framework package has bumped a peer major past what the consumer carries, a loud warning surfaces with the exact ranges and suggested fix:

```
  ⚠ Peer-dependency mismatches:
    vite  — required by @rudderjs/vite@3.0.0
      your package.json: devDependencies.vite = "^7.1.0"
      framework needs:    "^8.0.0"
      reason:             consumer accepts major 7, framework needs major 8
```

`--check` mode treats peer mismatches as part of the exit-1 condition, so CI gates catch them.

Closes the gap discovered on `rudderjs.com` (2026-05-29): `pnpm update --latest "@rudderjs/*"` happily bumps `@rudderjs/*` packages but doesn't notice when the framework has bumped a peer-dep major (`vite 7→8`, `react 18→19`, etc.). Apps stay on the old peer and miss the actual upgrade signal.

Internal: `acceptedMajors(range)` reduces a semver range to its accepted-major set (or `'any'`); `diffPeerRange(consumer, required)` intersects two ranges and surfaces a reason on no-overlap. Both fail open on unparseable input so they never block a working upgrade.
