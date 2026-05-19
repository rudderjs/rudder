---
'create-rudder-app': patch
---

Scaffolded `routes/web.ts` now imports `Tag` alongside `Post`/`Video`/`Comment`
when the polymorphic demo is selected. Without it, the generated
`/demos/polymorphic` handler hits `ReferenceError: Tag is not defined` on
first request (the handler calls `Tag.all()` and types `Tag[]`). Caught by
the new Phase 3 scaffolder render-check matrix on the `demos-all` profile.
