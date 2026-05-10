---
"@rudderjs/ai": minor
---

**A7 Phase 1 — computer-use action vocabulary + Playwright executor.** Foundation for the upcoming `computerUseTool({ page })` factory (phase 2). Mirrors Anthropic's `computer_20250124` action schema verbatim so phase 2 can map cleanly to Anthropic's native tool block.

- `ComputerAction` — discriminated union covering every action Anthropic's `computer_20250124` tool emits: `screenshot`, `cursor_position`, `wait`, `mouse_move`, `left_click` / `right_click` / `middle_click` / `double_click` / `triple_click` (with optional modifier text), `left_mouse_down` / `left_mouse_up` (drag), `type`, `key` (chord), `hold_key`, `scroll`.
- `executeComputerAction(page, action, state)` — async dispatcher against a Playwright `Page`. Updates `state.cursor` after every coordinate-targeted action so `cursor_position` can answer. Never throws — Playwright failures surface as `{ type: 'error', text }` for the agent loop to forward as a tool-result with `is_error: true`.
- `PageLike` — structural Playwright `Page` subset. Lets `@rudderjs/ai` type-check and execute without taking a hard dependency on the `playwright` package (which carries a 300MB+ Chromium download). Apps install Playwright themselves and pass `page` in.
- `makeExecutorState()` — constructs the per-run cursor-tracking state. Threaded through every call within an agent run.
- `parseModifiers`, `normalizeKey`, `normalizeChord` — translate Anthropic / xdotool key naming (`ctrl`, `cmd`, `Return`) to Playwright's (`Control`, `Meta`, `Enter`).

Subpath export: `@rudderjs/ai/computer-use`. Module is Node-only in practice (Playwright); main entry stays runtime-agnostic.

```ts
import { chromium } from 'playwright'
import { executeComputerAction, makeExecutorState } from '@rudderjs/ai/computer-use'

const page = await (await chromium.launch()).newPage()
await page.setViewportSize({ width: 1280, height: 800 })

const state = makeExecutorState()
const screen = await executeComputerAction(page, { action: 'screenshot' }, state)
await executeComputerAction(page, { action: 'left_click', coordinate: [400, 200] }, state)
```

Phase 2 (next PR) wires this through `computerUseTool({ page })` — the agent tool factory that emits Anthropic's native `computer_20250124` block at the API level and routes execution through this executor. Non-Anthropic models will throw `ComputerUseProviderError` at agent boot.

See `docs/plans/2026-05-10-ai-computer-use.md` for the full A7 plan.
