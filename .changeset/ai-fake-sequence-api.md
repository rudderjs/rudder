---
'@rudderjs/ai': minor
---

`AiFake`: add `respondWithSequence(steps)` and `failOnStep(stepIndex, error)` for scripting multi-step provider responses in tests. Each entry maps to one provider call (`{ text?, toolCalls?, finishReason? }`), so a tool-call loop can be exercised end-to-end without a real provider. Sequence exhaustion falls back to `respondWith`. `failOnStep` registers an error to throw on the Nth provider call, useful for testing onError middleware and failover paths. Streaming variant honors the same sequence.
