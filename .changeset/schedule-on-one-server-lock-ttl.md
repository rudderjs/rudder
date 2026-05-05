---
'@rudderjs/schedule': patch
---

Fix `onOneServer()` so the server-lock TTL — not task duration — controls how long a peer is kept out.

Previously `_executeTask` pushed every acquired lock onto a single list and released them all in `finally`. The 60-second server lock was released the instant the task callback returned, so a peer with a slightly delayed cron tick (NTP drift, GC pause, slow worker) could re-acquire and re-run the same scheduled minute. This violated the documented contract — "only run on a single server" — for any task whose body finishes faster than the gap between cluster cron ticks (i.e. essentially every task).

The server lock is now intentionally **not** released by `_executeTask`; its 60-second TTL is what guarantees "exactly one server per scheduled minute". Only the `withoutOverlapping` lock is released after the task completes, since that one's purpose is "release the next invocation as soon as the current one finishes".

Bonus: when `onOneServer` and `withoutOverlapping` are combined and the overlap lock collides (a previous run is still in progress), the server lock is no longer released either — releasing it would invite a peer to immediately retry the same colliding task within the minute.

Adds seven `_executeTask` test cases backed by `FakeCacheAdapter` covering: success, task throw, overlap-only, combined, peer-held server lock, no cache adapter, and overlap-collision-keeps-server-lock-held.
