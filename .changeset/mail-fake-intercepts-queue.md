---
"@rudderjs/mail": patch
---

Make the mail fake intercept queued mail. `Mail.to(...).queue()` / `.later()` route through `dispatchMailJob`, which never checked for an active fake despite `FakeMailAdapter.recordQueued`'s own contract documenting that it should. Under `Mail.fake()`, queueing a mailable therefore tried to resolve `@rudderjs/queue` and threw (or, when queue was installed, enqueued a real job that the fake never saw), so `fake.assertQueued()` / `assertNothingQueued()` could never pass for code that queues mail. `dispatchMailJob` now records to the active fake (duck-typed on `recordQueued`) before resolving the queue, so faked tests observe queued mail and do not need the queue package installed.
