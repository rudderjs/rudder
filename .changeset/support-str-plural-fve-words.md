---
"@rudderjs/support": patch
---

Fix `Str.plural()` and `Str.singular()` mangling common `-f`/`-fe` and `-oe` words. The pluralizer applied a blanket `-f`/`-fe` to `-ves` rule that only ever fired on words it got wrong (the genuine `-ves` words are in the irregulars map), producing `chef` to `cheves`, `roof` to `rooves`, `belief` to `believes`, `chief` to `chieves`, `proof` to `prooves`, and `giraffe` to `girafves`. The singularizer had the symmetric `oes` rule that turned `shoes` to `sho`, `toes` to `to`, and `foes` to `fo`. Both broad heuristics are removed; regular `-f`/`-fe` words now take a plain `-s`, the real `-ves` exceptions (calf, thief, wife, scarf, hoof, dwarf) are enumerated in the irregulars maps so they round-trip correctly, and `-oe` words singularize to `-oe`.
