---
"@rudderjs/pulse": patch
---

Fix an infinite recursion in `ExceptionRecorder` that crashed the process on the first reported exception. The recorder captured `report` as the "previous" reporter, but `report` always dispatches to the current reporter (the recorder's own wrapper), so forwarding re-entered itself until the stack overflowed. It now chains to the reporter returned by `setExceptionReporter`, and the record step is wrapped so a storage error never breaks the reporter chain.
