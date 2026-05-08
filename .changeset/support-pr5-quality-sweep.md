---
"@rudderjs/support": minor
---

Fix `Str.plural` producing `pianoes` for loanwords ending in `-o` (removed overly-broad rule; `potato`/`tomato`/`echo`/`hero`/`veto` are covered by irregulars). Fix `Str.singular` producing `drif` for verb forms like `drives` (tightened `/ves$/` to require a consonant before `-ves`). Fix `Collection.splitIn(0)` division-by-zero producing wrong results (add guard matching `chunk()`). Add `Collection.sortBy()` and `Collection.unique()`. Add `Str`, `Num`, and `t()` sections to boost guidelines. Add tests for `t()`, `validateSerializable()`, new Collection methods, and pluralization edge cases.
