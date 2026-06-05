---
"@rudderjs/database": patch
---

Suppress Vite's "dynamic import cannot be analyzed" dev-server warning from the native migrator. The migration-file loader imports user files from a runtime-computed path by design, so the import is marked `/* @vite-ignore */`.
