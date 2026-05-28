---
'@rudderjs/http': minor
---

Laravel-parity sequenced HTTP fakes — useful for testing retry, pagination, and back-off paths where each call should see a different response.

- **`FakeManager.sequence(pattern?)`** returns a `Sequence` builder registered to the manager. `pattern` defaults to a wildcard regex (`/.*/`) — pass a string or `RegExp` to scope.
- **`Sequence.push(response)`** appends a response to the queue.
- **`Sequence.whenEmpty(fallback)`** sets the response returned for every call past the queue.
- **`Sequence.isEmpty()` / `Sequence.remaining()`** — queue introspection.
- **`Http.fakeSequence(pattern?)`** shortcut returning `[fake, sequence]` for the common one-fake-one-sequence pattern.

Key difference from `register(pattern, [r1, r2])` (which silently repeats the last response forever): a `Sequence` **throws on exhaustion** unless `whenEmpty()` is set — so a hidden extra call surfaces in the test instead of getting a duplicate success response.

Found by the Phase 3 testing-ergonomics audit (cluster 9).
