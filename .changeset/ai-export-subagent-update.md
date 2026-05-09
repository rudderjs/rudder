---
'@rudderjs/ai': patch
---

Re-export `SubAgentUpdate` from the package entry. The type was defined in 1.4.0 alongside `Agent.asTool`'s streaming branch and is the recommended public discriminator for hosts wrapping streaming sub-agents — but it was never wired into the public types block, so consumers had to mirror the union locally or reach in via a deep `./types.js` path. No runtime change.
