# Computer-use

`@rudderjs/ai/computer-use` lets an agent drive a real browser. The agent emits actions (`click`, `type`, `screenshot`, …) in Anthropic's native `computer_20250124` vocabulary; we route those actions to a Playwright `Page` you provide.

```ts
import { Agent } from '@rudderjs/ai'
import { computerUseTool } from '@rudderjs/ai/computer-use'
import { chromium } from 'playwright'

const browser = await chromium.launch()
const page    = await browser.newPage()
await page.setViewportSize({ width: 1280, height: 800 })
await page.goto('https://example.com')

class BrowserAgent extends Agent {
  model() { return 'anthropic/claude-sonnet-4-6' }

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

const response = await new BrowserAgent().prompt('What is the title of this page?')
console.log(response.text)

await browser.close()
```

## Why this exists

Anthropic ships `computer_20250124`: a model-trained tool type that lets Claude drive a browser/desktop. Without our wrapper, you'd bind directly to the Anthropic SDK and lose the agent loop, observers, middleware, telescope, and approval-resume machinery you get from `@rudderjs/ai`. `computerUseTool({ page })` brings the native tool into the framework's normal agent surface — same `prompt()` / `stream()` / `withBudget()` / approval channel as any other tool.

## Setup

```bash
pnpm add @rudderjs/ai @anthropic-ai/sdk playwright
npx playwright install chromium
```

You also need `ANTHROPIC_API_KEY` in `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Configure the provider in `config/ai.ts`:

```ts
import type { AiConfig } from '@rudderjs/ai'

export default {
  default: 'anthropic/claude-sonnet-4-6',
  providers: {
    anthropic: { driver: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY! },
  },
} satisfies AiConfig
```

## Anthropic-only in v1

Computer-use is **Anthropic-only** today. Claude is fine-tuned on the exact `computer_20250124` schema; a generic function-call wrapper on top of OpenAI / Google / Gemini would work mechanically but produce dramatically worse output. The `model` arg makes this fail loud at agent boot:

```ts
computerUseTool({ page, model: 'openai/gpt-4.1' })
// → throws ComputerUseProviderError:
//   "computerUseTool is Anthropic-only in v1; got model 'openai/gpt-4.1'.
//    Use an 'anthropic/*' or 'bedrock/<region.>?anthropic.*' model, or remove the tool."
```

Bedrock-Anthropic models work too — they go through Anthropic's native API:

```ts
model() { return 'bedrock/anthropic.claude-sonnet-4-5-v1:0' }            // ✓
model() { return 'bedrock/us.anthropic.claude-opus-4-7-v1:0' }           // ✓ cross-region inference profile
```

OpenRouter-routed Anthropic does **not** work (`openrouter/anthropic/...`) — OpenRouter goes through the OpenAI SDK with a different base URL, so the native `computer_20250124` block can't reach the wire.

When OpenAI's `computer_use_preview` matures or we add a wrapper fallback for non-native providers, it'll slot in behind the same `computerUseTool({ page })` API — no public breakage.

## Options

```ts
computerUseTool({
  page,                                         // required: Playwright Page (or any PageLike)
  viewport: { width: 1280, height: 800 },       // default: 1280×800 (Anthropic's training distribution)
  model:    'anthropic/claude-sonnet-4-6',      // optional: triggers upfront ComputerUseProviderError check
  needsApproval: true,                          // default: true (every action gates through approval)
  maxActions: 50,                               // default: 50 (throws ComputerUseLimitError on overflow)
  state: undefined,                             // default: fresh state per tool instance
})
```

### `needsApproval`

Defaults to `true` — every action routes through the framework's approval middleware (the same channel `requireApproval: true` tools use). Real apps **should** leave this on; computer-use is the highest-blast-radius tool we ship. For demos and trusted workflows, you can opt out entirely or per-action:

```ts
// Off entirely
computerUseTool({ page, needsApproval: false })

// Per-action: gate destructive ones, let cheap ones through
computerUseTool({
  page,
  needsApproval: (action) => action.action !== 'screenshot' && action.action !== 'mouse_move',
})
```

### `maxActions`

Bounds runaway loops where the model keeps trying the same broken UI step. Default `50` — most real computer-use tasks finish well under that. Pair with `withBudget` from `@rudderjs/ai` to put a hard $ cap on top of the action cap:

```ts
import { withBudget } from '@rudderjs/ai'
import { ormBudgetStorage } from '@rudderjs/ai/budget-orm'

const budget = withBudget({
  user:    (ctx) => ctx.context as string,
  budget:  () => ({ daily: 0.50 }),  // 50¢/user/day
  storage: ormBudgetStorage(),
})

class BrowserAgent extends Agent {
  middleware() { return [budget] }
  tools() { return [computerUseTool({ page, model: this.model() })] }
}
```

Screenshot tokens are large — at 1280×800, each screenshot adds ~30K input tokens on Claude. A 15-action run can comfortably hit 500K input tokens. Document the cost loudly in any user-facing UI.

### `state`

Per-instance cursor-tracking state. The factory creates a fresh `ComputerExecutorState` by default; pass your own if you're resuming a paused session or want to seed the cursor at a specific position.

## What the model sees

When the agent serializes the request, our Anthropic adapter detects the computer-use tool's `providerHint` and emits Anthropic's native tool block instead of a function-call schema:

```json
{
  "type": "computer_20250124",
  "name": "computer",
  "display_width_px": 1280,
  "display_height_px": 800
}
```

Claude calls the tool with actions in its trained vocabulary:

```json
{ "action": "screenshot" }
{ "action": "left_click", "coordinate": [400, 200] }
{ "action": "type", "text": "hello world" }
{ "action": "key", "text": "ctrl+a" }
{ "action": "scroll", "coordinate": [640, 400], "scroll_direction": "down", "scroll_amount": 3 }
```

Our executor dispatches each action to the appropriate Playwright API. Screenshots come back as base64-encoded PNGs in an `image` content block; text actions return short confirmations (`"left-clicked at (400, 200)"`); failures surface as `{ type: 'error', text: ... }` and get forwarded to the model as `is_error: true` so it can retry or recover.

## Browser drivers other than Playwright

`computerUseTool({ page })` accepts anything matching the structural `PageLike` interface:

```ts
import type { PageLike } from '@rudderjs/ai/computer-use'

interface PageLike {
  mouse: { move, click, down, up, wheel }
  keyboard: { type, press, down, up }
  screenshot(opts?: { type?: 'png' | 'jpeg' }): Promise<Uint8Array>
}
```

**Playwright's `Page`** matches directly — pass it in.

**Puppeteer's `Page`** matches the type but has two API mismatches at runtime: `mouse.wheel` takes an options object instead of positional args, and `keyboard.press` doesn't parse chord syntax (`'Control+a'`). A ~30-line shim wraps a Puppeteer page into a Playwright-shaped object; we'll ship it as a first-class helper when there's demand.

**Custom environments** (Docker desktop, remote VNC, in-process mock) — implement `PageLike` and pass it in. The action vocabulary already covers everything; nothing about it is browser-specific.

## Running the playground demo

The framework's playground ships a working example at `/demos/browser`:

```bash
cd playground
pnpm dev                      # starts at :3000
# open http://localhost:3000/demos/browser
```

Source files: `playground/app/Agents/BrowserAgent.ts` (the agent class), `playground/app/Views/Demos/Browser.tsx` (the page UI), `playground/routes/api.ts` (`POST /api/browser/run` — launches Playwright + runs the agent).

## Errors

- **`ComputerUseProviderError`** (`code: 'COMPUTER_USE_PROVIDER_MISMATCH'`) — tool was constructed with `model: '...'` that isn't Anthropic-family. Fix the `model` arg or remove the tool.
- **`ComputerUseLimitError`** (`code: 'COMPUTER_USE_LIMIT_EXCEEDED'`) — agent emitted more actions than `maxActions`. Either bump the cap or tighten the agent's instructions.
- **Playwright `Executable doesn't exist`** — Chromium isn't installed. Run `npx playwright install chromium`.

Both error classes carry a stable `code` field for app-side `instanceof` + `.code` dispatch.

## Pitfalls

- **Approval gate is on by default.** Wire an approval UI (or set `needsApproval: false` for trusted contexts) — without one, the agent loop pauses and waits for a decision that never comes.
- **`viewport` must match `page.setViewportSize()`.** Claude grounds clicks in the dimensions you report. If they disagree, clicks land off-target.
- **Screenshot tokens are huge.** ~30K input tokens per step at 1280×800. Pair with `withBudget` and a low `maxActions` cap for unattended workloads.
- **The same tool instance shares state across runs.** The factory captures cursor state + action counter in its closure. Call `computerUseTool({ ... })` inside `Agent.tools()` (which Agent runs per request) for clean per-run state, or pass an explicit `state` per call.
- **OpenRouter-routed Anthropic doesn't work.** OpenRouter uses the OpenAI SDK; the native `computer_20250124` block can't be sent. Use Anthropic-direct or Bedrock-Anthropic.
