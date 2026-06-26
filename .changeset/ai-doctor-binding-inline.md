---
"@rudderjs/ai": patch
---

`@rudderjs/ai/doctor` is now a first-class implementation instead of a re-export of `@gemstack/ai-sdk/doctor`. The AI doctor check registers into `@rudderjs/console`'s registry, so it's a Rudder binding and belongs here, not in the agnostic engine. `@rudderjs/console` is now declared as an optional peer. Public exports and import path are unchanged.
