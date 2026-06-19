---
"@rudderjs/orm": minor
---

`Model.insertMany()` added as a mass-assignment-safe bulk insert (applies `fillable`/`guarded` per row). `Model.upsert()` now also filters rows through `fillable`/`guarded` before writing, matching `Model.create()` behaviour. The raw QB-level `query().insertMany()` remains available as the bypass path for trusted/seeder use.
