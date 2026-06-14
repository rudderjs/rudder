---
"@rudderjs/core": minor
---

`setExceptionReporter()` now returns the previously installed reporter. This lets a wrapper chain to the prior reporter correctly. Capturing `report` instead forwards to whatever the current reporter is (the wrapper itself), which re-enters infinitely. Existing callers that ignore the return value are unaffected.
