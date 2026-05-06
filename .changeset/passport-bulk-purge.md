---
'@rudderjs/passport': patch
---

`purgeTokens` (and the `passport:purge` command) now issues a single bulk
`deleteAll()` per model instead of reading every match into memory and looping
per-row deletes. One round-trip per model, no hydration, no N+1.
