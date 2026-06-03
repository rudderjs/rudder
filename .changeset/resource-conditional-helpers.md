---
'@rudderjs/orm': minor
---

Broader conditional helpers on `JsonResource` (Laravel parity): **`whenHas(attribute, value?, fallback?)`** includes only when the attribute is present on the underlying resource (covers Model partial-select hydration; `value` defaults to the attribute). **`whenCounted(relation, fallback?)`** includes the stamped `<relation>Count` only when `withCount('<relation>')` loaded it — a loaded zero is included. **`whenAggregated(relation, fn, column?)`** generalizes to any stamped aggregate alias (`whenAggregated('posts', 'sum', 'views')` reads `postsSumViews`); alias derivation reuses the ORM's own `aggregateAlias` builder, so the helpers can never drift from the loader's camelCase rules. `whenPivotLoaded` is deliberately not included — gated on pivot-column reads (a v1 non-goal).
