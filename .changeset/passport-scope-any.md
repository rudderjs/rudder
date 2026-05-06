---
'@rudderjs/passport': minor
---

Added `scopeAny(...scopes)` middleware — OR-semantic counterpart to the
existing `scope(...)` (AND). Use it when a route should accept any of a set
of scopes rather than requiring every one. Closes the Laravel parity gap
between `scope` and `scopes` middleware variants. Wildcard `*` still grants
everything; calling `scopeAny()` with no scopes is a no-op safety net rather
than an instant 403.
