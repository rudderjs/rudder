---
'@rudderjs/mail': minor
---

Expand `FakeMailAdapter` with combined sent + queued assertions and exact-count variants.

**Combined (sent OR queued):**
- `assertOutgoing(mailableClass, predicate?)` — match either channel; useful when the code under test might dispatch synchronously or via the queue.
- `assertOutgoingCount(n)` — total across both channels; failure message breaks down sent vs queued.
- `assertNothingOutgoing()` — neither sent nor queued.
- `outgoing(mailableClass?)` — access every entry across both channels (sent + queued).

**Exact-count per channel:**
- `assertSentTimes(mailableClass, count)` — exact sent count for the class.
- `assertQueuedTimes(mailableClass, count)` — exact queued count for the class.

The new combined helpers let tests assert that mail went out without coupling to the dispatch channel — useful for feature-flagged paths and retry policies where the implementation may switch between sync send and queue.

Found by the Phase 3 testing-ergonomics audit (cluster 7).
