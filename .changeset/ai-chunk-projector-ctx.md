---
'@rudderjs/ai': minor
---

feat(ai): thread correlation ctx into the streaming `ChunkProjector` on the resume paths

`ChunkProjector` now receives an optional 2nd arg `ctx: { originalSubRunId, key? }` on the `resumeAsTool` / `resumeManyAsTool` streaming paths. A batch host fanning N paused sub-agents through one `resumeManyAsTool` call can now route each raw `StreamChunk` to the correct per-sub-agent channel directly from a side-effect projector (`streaming: (chunk, ctx) => { pumpToChannel(ctx.originalSubRunId, chunk); return null }`), instead of having the rich chunk data in the projector but the correlation only in `onUpdate`.

Additive and non-breaking: `ctx` is optional, `defaultSubAgentProjector` ignores it, and every existing projector and `onUpdate` semantics are unchanged.
