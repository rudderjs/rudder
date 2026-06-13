---
"@rudderjs/orm": patch
---

Global scopes now receive the Model-layer hydrating query builder, matching local scopes, so a global scope can use the sugar methods (`whereIn`, `whereNull`, `when`, etc.). Previously a global scope was handed the bare adapter query builder and any sugar call threw "is not a function".
