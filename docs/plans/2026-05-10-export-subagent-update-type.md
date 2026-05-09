# Re-export `SubAgentUpdate` from `@rudderjs/ai` index

> **Filed by:** pilotiq side, 2026-05-10. One-line public-API gap.

## Problem

`@rudderjs/ai@1.4.0` defines `SubAgentUpdate` in `packages/ai/src/types.ts` (line 766) and uses it internally in `agent.ts` (`asTool` return generators, default projector signature). It is the recommended public discriminator for hosts wrapping streaming sub-agents — see `2026-05-09-asTool-streaming-and-suspend.md` lines 118–129:

> The default streaming projection emits one `SubAgentUpdate` per relevant chunk … *Hosts wanting a different shape pass `streaming: chunk => …` and own the discriminator. The shape above is the recommended default — pilotiq-pro will adopt it directly so its `agentRunRenderer` can stay almost identical.*

But it isn't re-exported from `packages/ai/src/index.ts`, so consumers can't `import type { SubAgentUpdate } from '@rudderjs/ai'`. Pilotiq-pro's Phase 1 migration (shipped today) had to mirror the union locally in `runAgentTool.ts` to type the generator's yield slot. The mirror is pure copy-paste of upstream's discriminator and rots if upstream evolves the union.

## Fix

Add `SubAgentUpdate` to the existing type-export block in `packages/ai/src/index.ts` (around line 69, just before the closing `} from './types.js'`):

```diff
   FileListResult,
   FileContent,
+  SubAgentUpdate,
 } from './types.js'
```

Verified locally — typecheck + build clean, tests 229/229 pass.

## Changeset

Patch on `@rudderjs/ai`. Suggested body:

> Re-export `SubAgentUpdate` from the package entry. The type was defined in 1.4.0 alongside `Agent.asTool`'s streaming branch but never wired into the public types block, so consumers couldn't import it without a deep `./types.js` path. No runtime change.

## Pilotiq-pro follow-up

Once this lands and pilotiq-pro bumps the peer-dep range:

1. Delete the local `SubAgentUpdate` mirror in `~/Projects/pilotiq-pro/packages/ai/src/handlers/chat/tools/runAgentTool.ts` (lines 1–14).
2. Replace with `import type { SubAgentRunSnapshot, SubAgentUpdate } from '@rudderjs/ai'`.
3. No other consumer-side changes — the union shape we mirror is byte-identical to upstream's.

Tracked in pilotiq memory: `project_pilotiq_pro_ai_phase_1_blocked.md` "Upstream gap caught" and `project_pilotiq_next_session.md` follow-up bullet.
