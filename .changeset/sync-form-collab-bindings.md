---
"@rudderjs/sync": minor
---

feat(sync): form-collab bindings (form-field ↔ share-type mapping)

Add field bindings that map a form field to the Yjs share type that backs it, so a structured form edits collaboratively. A `CollabFieldBindings` descriptor (`'scalar' | 'text' | 'array' | 'map'`, with an optional per-field `validate` predicate) declares the layout; it lives on a `CollabSeedResource`'s new `fields` property, so one resource drives auth, seeding, and share-type routing.

- `createCollabRoomSeeder` now routes each seeded value into the share its binding names — `text` → a dedicated `Y.Text`, `array` → a `Y.Array`, `map` → a nested `Y.Map`, `scalar` (the default) → an entry in the shared fields map. Scalars seed as a group gated on the shared map being empty (unchanged idempotence); each non-scalar share gates on its own emptiness, all in one origin-tagged transaction. A value the validator rejects is skipped (fail-soft). Resources without `fields` keep the flat scalar-only behavior.
- New `useCollabField` hook in `@rudderjs/sync/react` two-way binds a form input to its share for the value-shaped types (`scalar` / `array` / `map`): reads the current value, re-renders on peer changes, and returns a setter that validates then writes (returning `false` on rejection). Collaborative-string `text` fields bind through an editor (`useCollabSeedText`) and are excluded at the type level.

The contract is duck-typed with no `@rudderjs/orm` or form-schema dependency, the same posture as `createCollabRoomAuth` / `createCollabRoomSeeder`.
