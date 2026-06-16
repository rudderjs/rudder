---
'@rudderjs/ai': minor
---

feat(ai): scoped / multi-capability tool builder

Add `scopedTool({ name, description, capabilities, discriminator?, allow?, needsApproval? })` plus the `capability(spec)` helper. It collapses a discriminated union of N named capability branches into a single flat function-call schema with a `sub_tool` discriminator enum, because function-calling APIs (OpenAI, DeepSeek, others) don't reliably honor a top-level `oneOf`.

The generated schema merges the union of every branch's fields; a field is top-level `required` only when every branch requires it, and non-universal fields are annotated with the capabilities that use them. At call time the dispatch rejects an unknown/disabled discriminator with a clear error, validates the chosen branch's input (enforcing its per-branch required fields) before running its handler, and forwards `tool-update` yields from `async function*` branch handlers. `allow` narrows the exposed capabilities for per-plan gating. `flattenCapabilities()` and the `FlatPlan` type are exported for adapters and tests.
