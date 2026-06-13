---
"@rudderjs/cli": minor
---

Suggest the closest command on a typo. `rudder mgirate` now prints "Did you mean migrate?" before the usual unknown-command message, matching git/cargo/npm. Suggestions are ranked by edit distance against the live command list (so package-contributed and app commands are included), prefer the same namespace on ties, and are omitted entirely when nothing is close enough.
