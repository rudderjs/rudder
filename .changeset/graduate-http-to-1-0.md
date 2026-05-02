---
'@rudderjs/http': major
---

Graduate to 1.0.0. The `Http` facade, fluent `PendingRequest` builder, `Pool` (concurrency-controlled batches), `FakeManager` (testing helpers), `http()` factory, and the `httpObservers` registry exposed at `@rudderjs/http/observers` are now part of the stable public API.

Already dogfooded in the playground and consumed by `@rudderjs/telescope`'s HTTP collector via the observer contract. Future breaking changes will be flagged with major bumps and migration notes.
