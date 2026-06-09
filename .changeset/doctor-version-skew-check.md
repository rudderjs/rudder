---
'@rudderjs/cli': minor
---

feat(doctor): new `deps:version-skew` check — catch @rudderjs/* sibling version skew before it becomes a cryptic ESM link error

When sibling `@rudderjs/*` packages drift out of their declared version windows (typically via exact `pnpm.overrides` pins — the documented single-copy practice — silently overriding a dependency's floor), the failure surfaces at runtime as `SyntaxError: The requested module '@rudderjs/contracts' does not provide an export named '…'`, naming no package and no version. The new fast-path doctor check walks every installed `@rudderjs/*` package, reads its declared dependencies/peerDependencies on sibling `@rudderjs/*` packages, and verifies each against the version that actually resolves from that package's location (nested copy → pnpm virtual-store sibling → top level). Violations report the exact pair: `@rudderjs/session@2.3.0 requires @rudderjs/contracts ^1.16.0 — found 1.15.2`, with the overrides fix hint. Optional peers, `workspace:` ranges, and unparseable ranges never false-fire.
