# `rudder doctor` — monorepo workspace friendliness

**Status:** plan, 2026-05-23. Pickup task for the next framework session.
**Origin:** session 2026-05-23 in pilotiq — wired `rudder doctor` as a `predev` hook in both `pilotiq/playground/` and `pilotiq-pro/playground/` (the carry-forward task from `~/.claude/projects/-Users-sleman-Projects-pilotiq/memory/project_pilotiq_next_session.md` item #5). To make predev pass cleanly, scope had to be narrowed to `rudder doctor --only structure` — three built-in checks surface as reds/warns in standard workspace layouts even when the app is perfectly healthy. Shipping the consumer-side wire-up at `pilotiq/535f340` + `pilotiq-pro/27deaaf` proved the doctor command + dev-mode loader fix from 4.6.0 work end-to-end. This plan addresses the false positives that prevent unscoped `rudder doctor` from being the predev citizen it's meant to be.

---

## Why this exists

The doctor pre-flight is designed to be the right thing to run before `pnpm dev`, in CI, and as the first command when an app misbehaves. In a standard pnpm-workspaces monorepo — which is the dominant modern layout for any non-trivial JS project — three checks fire false positives when run from inside a workspace package:

1. **`env:package-manager` → red** — searches `process.cwd()` only. In a workspace package, `pnpm-lock.yaml` lives at the repo root, not next to the package's `package.json`. Result: "no lockfile found" even when the workspace is correctly installed. Predev exit non-zero, dev start blocked.

2. **`env:app-key` → red** — required for any app, but framework boot is lenient: `APP_KEY` is only consumed if a provider that depends on it (session signing, encryption) is wired. Demo / playground apps that don't use those providers boot fine without it; doctor still reports red.

3. **`deps:providers-manifest` → warn** — checks for `bootstrap/cache/providers.json` mtime vs `package.json` mtime. But `bootstrap/providers.ts` is allowed to be a **manual composition** that exports an explicit `[providers]` array instead of relying on auto-discovery. Apps that take this path (every pilotiq playground, by design — they compose pilotiq + adapter providers manually) trip a permanent warn that the user can never silence without abandoning the manual style.

Each is a 5-10 line fix in cli source. Together they let `"predev": "rudder doctor"` (no `--only` filter) Just Work in every workspace-aware rudder app — which is the experience the doctor command was always meant to deliver.

## Goals

- Unscoped `pnpm rudder doctor` exits 0 in a healthy app inside a pnpm/yarn/npm workspaces monorepo.
- Manual-composition `bootstrap/providers.ts` does not produce a permanent warn.
- `APP_KEY` is downgraded to warn (not error) when no provider in the boot graph consumes it.
- Workspace-detection logic is shared, not duplicated per-check.

## Non-goals

- Don't add a `--cwd` flag — the right behavior is automatic.
- Don't introduce a doctor config file. Conventions only.
- Don't change the doctor public API (`registerDoctorCheck`, `DoctorResult`, etc.).

## Architecture — workspace-root detection

New helper in `_fs.ts`:

```ts
/** Walk up from cwd until a workspace-root marker is found, or filesystem root. */
export function findWorkspaceRoot(start = process.cwd()): string {
  const markers = ['pnpm-workspace.yaml', 'lerna.json', '.git']
  let dir = start
  while (true) {
    for (const m of markers) {
      try {
        if (fs.statSync(path.join(dir, m))) return dir
      } catch { /* keep looking */ }
    }
    // package.json with "workspaces" field also counts (npm/yarn workspaces)
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
      if (pkg.workspaces) return dir
    } catch { /* keep looking */ }

    const parent = path.dirname(dir)
    if (parent === dir) return start  // hit filesystem root → fall back to cwd
    dir = parent
  }
}
```

`findWorkspaceRoot()` returns either the workspace root (when one is detected) or the original cwd (when standalone). All path-based checks use this as the lookup base when their semantics are workspace-scoped (lockfile, root tsconfig, root pnpm overrides).

## Fix 1 — `env:package-manager` looks at workspace root

```diff
-import { fileExists } from './_fs.js'
+import fs from 'node:fs'
+import path from 'node:path'
+import { findWorkspaceRoot } from './_fs.js'

 function detect(): DetectedPM {
   const lockMap: Array<[string, 'pnpm' | 'npm' | 'yarn' | 'bun']> = [
     ['pnpm-lock.yaml',    'pnpm'],
     ['package-lock.json', 'npm'],
     ['yarn.lock',         'yarn'],
     ['bun.lockb',         'bun'],
     ['bun.lock',          'bun'],
   ]
-  const lockfiles = lockMap.filter(([f]) => fileExists(f)).map(([f]) => f)
+  const root = findWorkspaceRoot()
+  const lockfiles = lockMap
+    .filter(([f]) => { try { return fs.statSync(path.join(root, f)).isFile() } catch { return false } })
+    .map(([f]) => f)
   …
 }
```

The message can mention the resolved root when found upstream of cwd:

```
✓ pnpm — lockfile present (workspace root: ../..)
```

so the user knows the check is doing the right thing. Test: add a workspace fixture in `built-in.test.ts` that puts the lockfile at a parent dir and the package.json at a child, asserts ok.

## Fix 2 — `deps:providers-manifest` recognizes manual composition

The current check only looks for `bootstrap/cache/providers.json`. Extend it to recognize when `bootstrap/providers.ts` exports an explicit non-empty array as its default export — that's the supported manual path.

```diff
 registerDoctorCheck({
   id:       'deps:providers-manifest',
   category: 'deps',
   title:    'providers manifest',
   run(): DoctorResult {
     const manifest = 'bootstrap/cache/providers.json'
+    const providersTs = readFileSafe('bootstrap/providers.ts')
+    // Manual composition: `export default [Provider, …]` (or `export default await ...`).
+    // Source-level grep is good enough — we don't need to type-check.
+    if (providersTs && /export\s+default\s+\[[\s\S]+?\]/.test(providersTs)) {
+      return { status: 'ok', message: 'manual composition (bootstrap/providers.ts)' }
+    }
     if (!fileExists(manifest)) {
       return {
         status:  'warn',
         message: 'missing — providers won\'t auto-discover',
         fix:     'pnpm rudder providers:discover',
       }
     }
     …
   }
 })
```

Caveats:
- Source-level pattern is approximate. A more robust path is to parse with the same lexer doctor already uses for `structure:bootstrap-providers` (which asserts default export). Re-use it.
- If the `[...]` is empty (`export default []`), that's still "no providers" — keep as a warn ("no providers registered") so empty manual files don't silently silence the check.
- Auto-discovery + manual composition can coexist (an app may have both `bootstrap/cache/providers.json` from `rudder providers:discover` AND a `bootstrap/providers.ts` that composes additional providers). When both exist, prefer the existing manifest-mtime check — that's the auto-discovery path's correctness signal.

## Fix 3 — `env:app-key` is a warn when no consumer is in the graph

Two paths, in order of preference:

**Preferred:** the env-var checks accept an optional `requiredBy: (string | { provider: string })[]` field declared at registration. When the registry has no entry for that field's `requiredBy` providers in the user's resolved provider graph, the check downgrades from error to warn (or skips entirely under `--only env`).

**Pragmatic interim:** soften the existing `env:app-key` check to warn (not error). The deep error message becomes a follow-up:

```diff
   run(): DoctorResult {
     const v = process.env['APP_KEY']
-    if (!v) return { status: 'error', message: 'unset', fix: …  }
+    if (!v) return {
+      status:  'warn',
+      message: 'unset — required by @rudderjs/session, encryption, signed URLs',
+      fix:     'Generate a 32-byte base64 key (e.g. `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"`) and put it in .env',
+    }
     …
   }
```

The deep variant is the right architecture but needs a small registry extension. The interim is two-line. Ship the interim; track the deep variant as a separate phase.

## Tests

- New fixture in `built-in.test.ts`: `workspace-package/` with `package.json` and no lockfile, `workspace-root/pnpm-workspace.yaml` + `workspace-root/pnpm-lock.yaml`. Run doctor with cwd at the package — assert `env:package-manager` returns ok.
- New fixture: `manual-providers/bootstrap/providers.ts` exports `export default [SomeProvider]`. Run doctor with no `bootstrap/cache/providers.json` — assert `deps:providers-manifest` returns ok with the manual-composition message.
- New fixture: `no-app-key/` with empty .env (no APP_KEY). Assert check returns warn, not error.

## Out-of-scope follow-ups

- Workspace-root tsconfig / pnpm-overrides checks (some doctor checks may grow to use the workspace-root path).
- Doctor JSON output mode (deferred from the original doctor plan).
- `--cwd` flag (would conflict with the auto-detect goal).

## Consumer prep that's already shipped

The pilotiq monorepo has already moved both playgrounds onto `@rudderjs/cli@^4.6.2` and uses `predev: rudder doctor --only structure` as a working interim. When the three fixes ship, those playgrounds can drop `--only structure` to get the full pre-flight without changing any other config. No coordinated release required — just a follow-up commit per playground.

## Sequencing

1. Add `findWorkspaceRoot` to `_fs.ts` + tests for the helper alone.
2. Fix `env:package-manager` to use it. Update the test fixture.
3. Fix `deps:providers-manifest` to recognize manual composition. Update the test fixture.
4. Soften `env:app-key` to warn (interim). Update test.
5. (Follow-up) Registry extension for `requiredBy` provider-graph awareness.

Phases 1-4 are independent and order-free. Phase 5 is the architectural follow-up worth its own session.
