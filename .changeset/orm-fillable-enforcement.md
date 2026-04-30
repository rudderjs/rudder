---
"@rudderjs/orm": minor
---

Enforce mass-assignment protection. `static fillable` (allowlist) and the new `static guarded` (denylist; pass `['*']` to lock everything) are now enforced on `Model.create()`, `Model.update()`, and `instance.fill()` — keys outside the policy are silently dropped before the data reaches the adapter. Both default to `[]` (no enforcement) so existing models that haven't set either keep working unchanged. When both are set, `fillable` wins.

New escape hatch:

- **`instance.forceFill(data)`** — mass-assign without applying the filter. Useful for trusted sources (factories, internal sync, fixtures).

`instance.save()` continues to bypass the filter — properties set one-by-one (`user.role = 'admin'; await user.save()`) are intentional, not mass-assignment, so the protection doesn't apply. Internally this routes through new private `_doCreate`/`_doUpdate` paths that skip the filter while still firing observers and mutators.

Heads-up for `firstOrCreate(attrs, values)`: the lookup `attrs` go through `create()` along with `values`, so they must be in `fillable` too — otherwise the lookup column won't be set on the new row. Add the lookup key to `fillable`, or build the record manually with `new Model().forceFill(...).save()`.
