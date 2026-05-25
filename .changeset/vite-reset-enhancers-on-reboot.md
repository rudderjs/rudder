---
"@rudderjs/vite": patch
---

Reset the page-context-enhancer registry on dev HMR re-boot. The registry is a persistent globalThis-backed append-only list, and three providers register an enhancer in `boot()` (auth → `user`, localization → `locale`, session → `flash`). Without a reset, each re-boot accumulated a duplicate enhancer per package per edit — unbounded growth, with every page render re-running each enhancer N times. `performReboot` now calls `resetPageContextEnhancers()` alongside clearing the app singletons, so the re-bootstrap re-registers them cleanly (mirrors the `router.reset()` contract). No-op in production (single boot).
