---
"@rudderjs/core": minor
---

Provider manifest now self-heals at boot — `providers:discover` is no longer a per-install chore. The manifest (v3) carries a fingerprint of the dependency state; when it's missing or stale (a raw `pnpm add`/`remove` without `rudder add`), `defaultProviders()` rescans `node_modules` automatically. Development rewrites the manifest (atomic) with a one-line log; production honors a stale manifest for deterministic boots (with a warning) and scans in memory when it's missing. `providers:discover` remains as the build-step primitive for bundled/serverless deploys where `node_modules` doesn't exist at runtime. Legacy v2 manifests keep working and upgrade themselves on the next dev boot.
