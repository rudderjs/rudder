# `@rudderjs/*` — cross-package version skew fails with cryptic ESM errors; needs a diagnostic

**Status:** proposed (2026-06-09)
**Packages:** `@rudderjs/console` (doctor check — primary), optionally `@rudderjs/support` (boot-time assert helper)
**Driver:** pilotiq-pro dep bump 2026-06-09 — two independent skew breaks, each surfacing as a cryptic ESM link error naming no package and no version. Both were root-caused by hand and mitigated app-side with exact `pnpm.overrides` pins.

---

## Problem

When sibling `@rudderjs/*` packages drift out of their supported version window, the failure mode is an ESM **link-time** error that gives the user nothing to act on:

```
SyntaxError: The requested module '@rudderjs/contracts' does not provide an export named 'REQUEST_CONTEXT'
```

Known instances from the 2026-06-09 bump:

- `@rudderjs/session@2.3.0` imports `REQUEST_CONTEXT` from contracts (`packages/session/src/index.ts:5`); the symbol exists only since `contracts@1.16.0` (`packages/contracts/src/index.ts:1020`).
- `@rudderjs/cli@4.14.0` imports `down`/`up` from core (`packages/cli/src/commands/maintenance.ts:3`); those exist only since `core@1.11.0`. Here the symptom was migrate commands fast-failing.

### The declared ranges are already correct — that's the point

Verified on the published tarballs: `session@2.3.0` declares `@rudderjs/contracts: ^1.16.0`, `cli@4.14.0` declares `@rudderjs/core: ^1.11.0` — `workspace:^` resolves the floors properly at publish time. **This is not a manifest bug.** The skew gets in anyway because real apps pin `@rudderjs/*` with exact `pnpm.overrides` — the pattern the ecosystem itself pushes them toward (single-copy dedupe for Vite SSR `instanceof` safety, provider-class assignability, peer-hash splits). `pnpm.overrides` silently overrides every declared range in the tree, and pnpm emits no warning when an override violates a dependency's declared floor. So the first signal the user gets is the link error above, at runtime, with no package/version named.

## Impact

- Every coordinated rudder release risks this for every app using overrides pins (which is the documented best practice for rudder + pilotiq apps). Two instances in one bump; the class will recur each time a package starts importing a newly added sibling symbol.
- Diagnosis requires knowing rudder's internals (which release added which export) — downstream users have no path from the error to the fix.

## Fix options

1. **`rudder doctor` skew check (recommended).** A check registered via the existing `registerDoctorCheck` framework (`packages/console/src/doctor.ts`; contribution pattern: `packages/session/src/doctor.ts`): walk the installed `@rudderjs/*` packages in `node_modules`, read each one's `package.json` `dependencies`/`peerDependencies` on sibling `@rudderjs/*` packages, and `semver.satisfies` them against the *installed* sibling versions. On violation:
   > `@rudderjs/session@2.3.0 requires @rudderjs/contracts ^1.16.0 — found 1.15.2 (pinned by pnpm.overrides?). Bump the override.`
   Zero runtime cost, catches *every* future instance of the class without per-symbol bookkeeping, and `doctor` is exactly where users already look after an upgrade. Consider also running it (warn-only) inside `providers:discover`, which apps already re-run after dependency churn.

2. **Boot-time sibling assert for known-fragile pairs (optional, additive).** A tiny Node-only helper in `@rudderjs/support`, e.g. `assertSiblingVersion('@rudderjs/contracts', '>=1.16.0', 'REQUEST_CONTEXT support')`, called from a package's provider `register()`. It reads the resolved sibling's `package.json` version and throws with the same actionable message. Note: probing the *symbol* itself can't work for the package's own static imports — a missing named export throws at link time before any module code runs — so the assert must be version-based and live in code that loads *before* the fragile importer, or the fragile import must be made lazy. This is why option 1 (out-of-band check) is the primary recommendation; option 2 is only worth it for pairs whose failure blocks even reaching `doctor` (e.g. cli↔core breaking the CLI itself — there, `cli`'s command registry could lazy-import `maintenance.js` and translate the failure).

## Verification

- App with `pnpm.overrides` pinning `@rudderjs/contracts` at 1.15.x alongside `session@2.3.0`: `rudder doctor` flags the exact pair with both versions and the required range; with correct pins it stays green.
- The check ignores non-rudder deps and tolerates missing optional peers (e.g. session's optional `@rudderjs/vite` peer).
- cli self-break scenario (core too old for `down`/`up`): confirm the chosen mitigation produces a named-version error instead of the bare ESM `SyntaxError`.

## References

- `packages/session/src/index.ts:5` + `packages/contracts/src/index.ts:1020` — REQUEST_CONTEXT pair.
- `packages/cli/src/commands/maintenance.ts:3` — down/up pair.
- `packages/console/src/doctor.ts` — doctor framework; `packages/session/src/doctor.ts` — per-package check contribution pattern.
- Field report: pilotiq-pro dep-bump fallout 2026-06-09 (PR #30 thread) — both instances, mitigated by exact overrides pins.
