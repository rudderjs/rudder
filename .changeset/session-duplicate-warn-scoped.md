---
"@rudderjs/session": patch
---

Fix `_duplicateInstallWarned` scoping: move the flag inside `sessionMiddleware()` so each new call resets it. Previously the module-level flag suppressed the duplicate-install warning permanently after the first hit, hiding re-introduced misconfigurations across HMR re-boots and making duplicate-install tests order-dependent.
