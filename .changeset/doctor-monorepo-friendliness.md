---
"@rudderjs/cli": patch
---

`rudder doctor` is now friendlier to workspace monorepos and apps that don't use session/auth:

- **`env:package-manager`** walks up to the workspace root (`pnpm-workspace.yaml` / `lerna.json` / `.git` / `package.json#workspaces`) to find the lockfile. Previously it only looked in `process.cwd()` and reported red inside any sub-package.
- **`deps:providers-manifest`** detects manual composition by the absence of `defaultProviders(` in `bootstrap/providers.ts` and returns ok — apps that hand-compose providers no longer get a permanent "missing manifest" warn.
- **`env:app-key`** is downgraded from error to warn when `bootstrap/providers.ts` doesn't reference session / auth / passport providers. Apps that genuinely need APP_KEY (anything wiring `defaultProviders()`, `SessionProvider`, `AuthProvider`, or `PassportProvider`) keep the hard error.

This unblocks unscoped `pnpm rudder doctor` as a `predev` pre-flight in workspace-shaped apps like `pilotiq/playground` and `pilotiq-pro/playground` — they can drop the `--only structure` filter once on this version.
