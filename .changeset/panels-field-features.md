---
'@boostkit/panels': minor
---

Add conditional fields, field-level access control, per-field validation, display transformers, and ComputedField.

- `showWhen(field, op?, value)` / `hideWhen(...)` / `disabledWhen(...)` — serializable data-driven conditions evaluated live in create/edit forms; supports `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not_in`, `truthy`, `falsy` operators
- `readableBy(ctx => bool)` — strip field from list/show responses when fn returns false (server-side)
- `editableBy(ctx => bool)` — mark field readonly in the form when fn returns false (server-side)
- `validate(async (value, data) => string | true)` — per-field async validator; receives full form payload for cross-field checks
- `display(fn)` — server-side value formatter applied in list/show responses before JSON is sent
- `ComputedField` — virtual column with no DB backing; `.compute(record => value)` derives value per record; chains with `.display(fn)`
- `HasMany.display()` renamed to `HasMany.displayField()` (no breaking change for users of `RelationField.displayField()`)
