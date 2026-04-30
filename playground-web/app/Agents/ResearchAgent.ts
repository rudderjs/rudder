import { Agent } from '@rudderjs/ai'
import type { HasTools, AnyTool } from '@rudderjs/ai'

export class ResearchAgent extends Agent implements HasTools {
  instructions(): string {
    return 'You are a helpful assistant.'
  }

  // model(): string | undefined { return 'anthropic/claude-sonnet-4-5' }

  tools(): AnyTool[] {
    return []
  }
}
