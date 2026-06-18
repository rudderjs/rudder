---
"@rudderjs/sanctum": patch
---

Fix timing side-channel in `MemoryTokenRepository.findByToken`: replace early-return loop with a full scan so iteration time is constant regardless of whether a match is found. Also documents `MemoryTokenRepository` as dev/testing only via `@internal` JSDoc.
