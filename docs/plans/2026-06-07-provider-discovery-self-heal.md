# Provider discovery: self-healing manifest (no manual `providers:discover`)

**Filed:** 2026-06-07
**Packages:** `@rudderjs/core` (primary), docs
**Outcome:** users never run `providers:discover` by hand; the command survives as a build-pipeline primitive.

## Context — how it works today

- `pnpm rudder providers:discover` scans `node_modules/@*/*` for packages with a
  `rudderjs` package.json field (`packages/core/src/commands/providers-discover.ts`,
  CLI is a thin wrapper) and writes `bootstrap/cache/providers.json`
  (`{ version: 2, generated, providers }`, gitignored).
- `defaultProviders()` (`packages/core/src/default-providers.ts`) reads the manifest at
  boot; on **any** read error it silently falls back to the minimal 7-entry
  `BUILTIN_REGISTRY` — a fresh clone boots *partially* instead of failing.
- `rudder add` / `rudder remove` already re-run discovery. The scaffolder runs it on
  `--install`. The uncovered paths are **raw `pnpm add/remove/update`** and
  **fresh clones** — both produce the two CLAUDE.md pitfalls
  (*"new framework package isn't loading"*, *"listed in manifest but not installed"*).

Laravel parity note: Laravel users never run `package:discover` manually — composer's
`post-autoload-dump` hook runs it. Manual discovery is *less* Laravel than automatic.

## Design

### Fingerprint (manifest v3)

`writeProviderManifest()` stamps a fingerprint of the dependency state it scanned:

```jsonc
{
  "version": 3,
  "generated": "...",
  "fingerprint": {
    "depsHash": "sha256 of JSON({ dependencies, devDependencies }) from the app package.json",
    "lockfile": { "name": "pnpm-lock.yaml", "size": 123456, "mtimeMs": 1765100000000 }  // first lockfile found; omitted if none
  },
  "providers": [ ... ]
}
```

- `depsHash` catches add/remove edits to package.json. One file read + tiny hash.
- `lockfile` (stat only — never read/hash the multi-MB file) catches in-range
  `pnpm update`s that change an installed package's `rudderjs` field. O(1) stat.
- Staleness = either present-and-different. Absent fields are skipped (no lockfile
  deployed → only depsHash is compared).
- Spurious staleness (CI cache restoring odd mtimes) is harmless: one extra rescan,
  manifest rewritten with the new fingerprint, self-corrects.

### Boot-time self-heal in `defaultProviders()`

New resolution order (replaces the silent two-step today):

**Development** (`NODE_ENV`/`APP_ENV` not production — same heuristic as the dev boot log):
1. Manifest exists + fingerprint fresh → use it (today's fast path, unchanged: 1 read + 1 stat).
2. Manifest exists + stale (or legacy v2 with no fingerprint) → rescan, rewrite, use.
   One log line: `[RudderJS] provider manifest regenerated (<reason>)`.
3. Manifest missing → scan, write, use. Same log line.
4. Scan impossible (no `node_modules`, e.g. bundled) → `BUILTIN_REGISTRY` (today's fallback).

**Production:**
1. Manifest exists → **use it even if stale** (deterministic boots win), but `console.warn`
   on a stale fingerprint. Legacy v2 manifests are used silently — no upgrade noise.
2. Manifest missing → scan **in memory**, use the result, `console.warn` advising
   `providers:discover` in the build step. Best-effort write, failure swallowed —
   read-only filesystems (Lambda, distroless containers) are expected here.
3. Scan impossible → `BUILTIN_REGISTRY`, as today.

Manifest writes go through the existing atomic-write pattern (tmp + rename — same
family as the #774 TOCTOU sweep; never `existsSync` + write).

### What deliberately does NOT change

- **`providers:discover` stays** — build pipelines for bundled/serverless deploys
  must bake the manifest at build time (no `node_modules` at runtime to scan).
  Docs reposition it as a build-step primitive, not a per-install chore.
- **`rudder add`/`remove` keep their explicit discover step** — instant freshness,
  no first-boot scan.
- **`skip:` option and `rudderjs.autoDiscover: false`** — untouched; both operate on
  the entry list after manifest resolution and during scan respectively.
- **Scan scope** stays scoped-packages-only (`node_modules/@*/*`) — same as the command.

### Considered and rejected

- **`postinstall` script in scaffolded apps** (the literal composer-hook equivalent):
  rejected. PM behavior varies (`--ignore-scripts` CI, inconsistent firing on
  `remove` across npm/yarn/pnpm), it only helps newly scaffolded apps, and the boot
  self-heal subsumes it entirely. Not worth template churn.
- **Scan on every dev boot, no fingerprint**: simpler, but the scan walks every scoped
  package in `node_modules` (hundreds of dirs in real apps) on every re-boot — the
  HMR re-boot path is hot (~75ms budget, #645–#652). The fingerprint check is 1 read
  + 1 stat.
- **Hashing the lockfile** instead of stat: 1–10MB hash on every boot for marginal
  accuracy. Stat is enough; false-stale self-corrects.

### Edge cases

| Case | Behavior |
|---|---|
| Fresh clone, first `pnpm dev` | manifest missing → scan + write + log (today: silent partial boot off BUILTIN_REGISTRY) |
| `pnpm add @rudderjs/horizon` then dev re-boot | fingerprint stale → regen; horizon boots without any command |
| Dev server already running during `pnpm add` | next re-boot self-heals; the vite watcher does NOT watch package.json (non-goal; note for later) |
| `pnpm update` bumping a package whose `rudderjs` field changed | lockfile stat differs → regen |
| Read-only FS in prod, manifest missing | in-memory scan + warn, write failure swallowed |
| Legacy v2 manifest after framework upgrade | dev: regen once (counts as stale); prod: used silently |
| Concurrent dev re-boots | self-heal runs inside `defaultProviders()`, which runs inside the single-flighted boot (`__rudderjs_boot__`) — no extra locking needed |

## Implementation steps (one PR)

1. `packages/core/src/commands/providers-discover.ts` — add `computeFingerprint(cwd)`;
   `writeProviderManifest()` stamps it; bump manifest `version` to 3. Atomic write.
2. `packages/core/src/provider-registry.ts` — extend `ProviderManifest` type
   (`version: 2 | 3`, optional `fingerprint`).
3. `packages/core/src/default-providers.ts` — implement the resolution table above.
   Keep all node imports lazy (browser-safe module, see header comment).
4. Tests (`default-providers.test.ts` + manifest round-trip): missing-manifest scan+write,
   stale regen (dev), prod stale keep+warn, prod missing in-memory+warn, legacy v2,
   no-node_modules fallback, write-failure swallow.
5. Docs: `docs/guide/service-providers.md` (+ any deploy guide mentioning discover) —
   "automatic; run in build pipelines for bundled deploys".
   Root `CLAUDE.md`: delete the two pitfalls, update the Provider Auto-Discovery section.
6. Changeset: `@rudderjs/core` minor.

## Acceptance

- Fresh-clone playground: delete `bootstrap/cache/providers.json`, `pnpm dev` → full
  provider set boots, manifest re-appears, one log line.
- `pnpm add @rudderjs/<pkg>` (raw, not `rudder add`) → next boot loads it, no command.
- `NODE_ENV=production` with stale manifest → manifest honored + warning.
- Re-boot hot path unchanged when fingerprint is fresh (no scan in the profile).

## Relationship to `rudder fresh` (DX backlog item 3)

This lands first: `fresh` then drops "regenerate providers manifest" from its spec
entirely — the boot self-heals. `fresh` becomes `migrate:fresh [--seed]` + cache clear
(`optimize:clear` parity command) only.
