---
"@rudderjs/telescope": patch
---

Three fixes:

- **Prune no longer wipes the whole store.** The API route handlers carried a truncated copy of the entry-type list (missing `http`, `gate`, `dump`, `ai`, `mcp`, `view`). `DELETE /telescope/api/entries?type=ai` (or any of those six) fell through to the prune-all branch and deleted every entry; the overview also hid their dashboard tiles. The list is now derived from a single `ALL_ENTRY_TYPES` source of truth shared by both route modules, with `EntryType` derived from it so the two can't drift again.
- **Exceptions are forwarded again.** `ExceptionCollector` captured `report` as the previous reporter, so its re-entry guard caused exceptions to be recorded but never handed off to the reporter installed before it (e.g. the log channel). It now chains to the reporter returned by `setExceptionReporter`.
- **Graceful degradation for the optional queue peer.** The job collector imported `@rudderjs/queue/observers` at module top level, crashing telescope's boot when the optional `@rudderjs/queue` peer wasn't installed. It now lazy-imports inside `register()` like every other collector.
