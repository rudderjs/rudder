---
"@rudderjs/orm": minor
---

Add `Model.sole()` and `HydratingQueryBuilder.sole()` — returns the single matching row or throws `ModelNotFoundError` (HTTP 404) for zero results and `MultipleRecordsFoundError` (HTTP 422) for two or more. Uses `LIMIT 2` internally. `MultipleRecordsFoundError` is a new exported error class with `code: 'MULTIPLE_RECORDS_FOUND'`.
