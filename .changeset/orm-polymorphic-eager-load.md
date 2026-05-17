---
'@rudderjs/orm': minor
---

`Model.with(...)` now resolves polymorphic relations — `morphOne`, `morphMany`, `morphTo`, `morphToMany`, `morphedByMany` — instead of throwing or forcing N+1.

The Model layer detects polymorphic relation names, partitions them away from the adapter call (which keeps using Prisma's `include` / Drizzle's `with` for direct relations), and resolves them in batched IN-queries after the terminal hydrates. One query per `morph{One,Many}` relation, two for pivot-mediated `morph{ToMany,edByMany}`, one query per distinct discriminator for `morphTo`. Soft-deletes on the related table are respected automatically (queries route through the Model's own query path).

**Before:** `Post.with('comments').all()` threw `Unknown field 'comments' for include statement on model 'Post'` on Prisma — apps were forced into N+1 via per-row `instance.related('comments').get()` calls.

**After:** Single batched query. Playground bench (100 posts): N+1 lazy = 22.3 ms → eager = 1.5 ms = **14.9× speedup** on the canonical example.

Direct relations (`hasOne` / `hasMany` / `belongsTo` / `belongsToMany`) keep going through the adapter unchanged — no behavior change. Out-of-scope for v1: nested polymorphic eager-load (`Post.with('comments.author')`) and constrained polymorphic eager-load (`Post.with('comments', q => q.where(...))`). See `docs/plans/2026-05-18-polymorphic-eager-load.md` for the design.
