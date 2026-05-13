---
"@rudderjs/telescope": minor
---

Add opt-in real-time dashboard updates over Server-Sent Events.

Set `updates: 'stream'` in `config/telescope.ts` and the per-watcher list pages subscribe to a new `<path>/api/stream` endpoint via `EventSource`. New entries appear the moment they're recorded — no polling, no peer dependencies, no WebSocket upgrade. Pure HTTP; the existing recording toggle and auth gate still apply.

Default stays `updates: 'polling'` (no behavior change for existing apps). A new `pollInterval` config knob (default `2000` ms) replaces the previously hardcoded interval.
