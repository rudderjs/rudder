---
'@rudderjs/ai': minor
'@rudderjs/telescope': patch
---

Add `agent.step.completed` observer event. Fires after every iteration of the agent loop with the completed step's data plus running totals (cumulative tokens, cumulative duration). Lets observers report incremental progress in real-time without waiting for the full run to finish — useful for live UIs (typing indicators, per-step token counters), pulse instrumentation, or step-level audit logging.

The terminal events (`agent.completed`, `agent.failed`) still fire after the loop exits and carry the full `steps` array. Step events are additive — existing subscribers see the new event flow through but can ignore it by checking `event.kind`. Telescope's `AiCollector` already does this so the dashboard's one-entry-per-run model is unchanged.

Closes Copilot review item 20.
