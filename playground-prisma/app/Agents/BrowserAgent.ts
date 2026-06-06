import { Agent, type AnyTool, type HasTools } from '@rudderjs/ai'
import { computerUseTool, type PageLike } from '@rudderjs/ai/computer-use'

/**
 * Demo agent that drives a real browser via Playwright + Anthropic's
 * native computer-use tool. Used by the `/demos/browser` page.
 *
 * Construct with a Playwright `Page` (or anything `PageLike`-shaped):
 *
 * ```ts
 * import { chromium } from 'playwright'
 *
 * const browser = await chromium.launch()
 * const page    = await browser.newPage()
 * await page.setViewportSize({ width: 1280, height: 800 })
 * await page.goto(startUrl)
 *
 * const agent = new BrowserAgent(page)
 * const response = await agent.prompt(`Find the ${query} on this page.`)
 * await browser.close()
 * ```
 *
 * Caps `maxActions` at 15 by default (cheap demo budget; ~30K image
 * tokens × 15 ≈ 450K input tokens worst case) — bump for real use.
 *
 * Approval is OFF in the demo (`needsApproval: false`) so the agent
 * runs autonomously. Real apps SHOULD leave the default `true` and wire
 * an approval UI; computer-use is the highest-blast-radius tool we ship.
 */
export class BrowserAgent extends Agent implements HasTools {
  constructor(private readonly page: PageLike) {
    super()
  }

  override model(): string {
    // Computer-use is Anthropic-only in v1.
    return 'anthropic/claude-sonnet-4-5'
  }

  override instructions(): string {
    return [
      'You drive a web browser to answer the user\'s question.',
      'Take a screenshot first to see the page; then click, scroll, or type as needed.',
      'When you have the answer, respond in plain text — do not call more tools.',
      'Be concise: the user wants a direct answer, not a tour of the page.',
    ].join('\n')
  }

  tools(): AnyTool[] {
    return [
      computerUseTool({
        page:          this.page,
        viewport:      { width: 1280, height: 800 },
        model:         this.model(),     // upfront provider check
        needsApproval: false,            // demo: run autonomously
        maxActions:    15,               // demo: cap cost
      }),
    ]
  }
}
