---
"@rudderjs/sanctum": patch
---

Internal cleanup: centralize the `req.raw` typed-bag access pattern behind a single `rawBag()` helper, drop redundant `as string | undefined` casts on header reads (already typed via `noUncheckedIndexedAccess`), and use the augmented `req.user` / `req.token` properties directly instead of `as unknown as Record<string, unknown>` indirection. Source casts: 5 → 2. Added tests for the no-expiry token path, empty-abilities array (which must NOT grant full access — that's `null`'s semantic), and the `req.user` direct-property fallback to mirror the existing `req.token` coverage. No public API changes.
