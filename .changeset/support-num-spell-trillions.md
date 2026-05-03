---
'@rudderjs/support': patch
---

fix(support): `Num.spell()` now handles trillions

The implementation topped out at billions while the JSDoc claimed support up to `10^15 - 1`. `Num.spell(1_000_000_000_000)` now returns `'one trillion'` instead of the previous incorrect output.

Also adds comprehensive test coverage for `Str` and `Num` (~40 tests covering `camel`/`snake`/`kebab`/`studly`/`title`/`headline`/`limit`/`words`/`excerpt`/`contains`/`startsWith`/`endsWith`/`before`/`after`/`between`/`replace*`/`pad*`/`squish`/`trim`/`mask`/`ascii`/`slug`/`uuid`/`isUuid`/`isUlid`/`random`/`password`/`plural`/`singular` and `format`/`currency`/`percentage`/`fileSize`/`abbreviate`/`ordinal`/`clamp`/`trim`/`spell`).

Adds Collection coverage for previously-untested helpers: `flatMap`, `reject`, `first(predicate)`, `last(predicate)`, `contains(value)`, `isNotEmpty`, `sole`, `keyBy`, `mapWithKeys`, `chunk`, `splitIn`, `partition`, `sliding`, `zip`, `crossJoin`, `combine`, `mapSpread`, `when`, `unless`, `pipe`, `tap`.
