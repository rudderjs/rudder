---
"@rudderjs/ai": minor
---

**A7 Phase 2 — `computerUseTool({ page })` factory + Anthropic native tool block.** Wires phase-1's executor into the agent loop. The tool maps to Anthropic's native `computer_20250124` tool block at the API level — Claude is fine-tuned on that exact tool, so quality is dramatically better than a generic function-call wrapper.

```ts
import { Agent } from '@rudderjs/ai'
import { computerUseTool } from '@rudderjs/ai/computer-use'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page    = await browser.newPage()
await page.setViewportSize({ width: 1280, height: 800 })

class BrowserAgent extends Agent {
  model() { return 'anthropic/claude-opus-4-7' }

  tools() {
    return [
      computerUseTool({
        page,
        viewport: { width: 1280, height: 800 },
        model:    this.model(),   // upfront provider check (recommended)
      }),
    ]
  }
}
```

- **`computerUseTool({ page, viewport?, model?, needsApproval?, maxActions?, state? })`** — plain object tagged with `Symbol.for('rudderjs.ai.computer-use')` (mirrors `HANDOFF_MARKER`). Tool name is fixed to `'computer'` (Anthropic-trained). `model` (optional) fails loud with `ComputerUseProviderError` for non-Anthropic models; without it, validation is deferred. `needsApproval` defaults to `true` and forwards through the standard approval channel. `maxActions` defaults to `50` per agent run; exceeding throws `ComputerUseLimitError`.
- **`ComputerUseProviderError`** (`code: 'COMPUTER_USE_PROVIDER_MISMATCH'`) and **`ComputerUseLimitError`** (`code: 'COMPUTER_USE_LIMIT_EXCEEDED'`) — both extend `Error`, both carry stable `code` fields for app `instanceof` + `.code` dispatch.
- **`isAnthropicLikeModel(model)`** — helper recognizing `anthropic/*` and `bedrock/<region.>?anthropic.*` (covers cross-region inference profiles `us.anthropic.*`, `eu.anthropic.*`, `apac.anthropic.*`). Excludes OpenRouter-routed Anthropic models — OpenRouter goes through the OpenAI SDK with a different base URL, so Anthropic's native computer-use block can't reach the wire.
- **`isComputerUseTool(t)`** typeguard for adapters / observers.

**Anthropic adapter changes** (`packages/ai/src/providers/anthropic.ts`):

- `toAnthropicTools` recognizes `providerHint?.type === 'computer-use'` and emits the native `{ type: 'computer_20250124', name, display_width_px, display_height_px }` block instead of the standard function-call shape. Honors `providerHint.tool` for forward-compat with future schema versions.
- `toAnthropicMessages` widens tool-message content handling: `string` passes through unchanged; `ContentPart[]` expands via the existing `contentToAnthropicParts` helper (so screenshot results emit as Anthropic's `content: [{ type: 'image', source: { type: 'base64', media_type, data } }]` shape); other values JSON-stringify (legacy fallback). Generic enhancement — useful for any future tool that wants to return rich content.

**`ToolDefinitionSchema`** gains an optional **`providerHint?: ProviderHint`** field. Adapters that recognize the `type` substitute their native serialization; others ignore it and emit the standard function-call shape. Currently used only by `@rudderjs/ai/computer-use`; opens the door for OpenAI / Google native tool blocks later.

**Out of this phase, deferred:**

- **Phase 3 — playground demo.** `playground/app/Agents/BrowserAgent.ts` + `/demos/browser` page wiring this end-to-end with a real Chromium and a streaming agent run. Lands in the next PR.
- **OpenAI native `computer_use_preview`** mapping. `providerHint` mechanism is in place; add when the API leaves preview and quality is competitive.
- **Function-call wrapper fallback** for non-native providers. Becomes a `wrapperFallback: true` opt on `computerUseTool` once a customer asks.
- **Custom `ComputerEnvironment` interface.** Today the tool takes a Playwright `Page` directly. If a second backend appears (Puppeteer, remote VNC, Docker sandbox), introduce an interface and keep `page` as the Playwright shorthand.

Plan: `docs/plans/2026-05-10-ai-computer-use.md`.
