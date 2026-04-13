import type { MakeSpec } from '@rudderjs/rudder'

export const makeAgentSpec: MakeSpec = {
  command:     'make:agent',
  description: 'Create a new AI agent class',
  label:       'Agent created',
  suffix:      'Agent',
  directory:   'app/Agents',
  stub: (className) => `import { Agent } from '@rudderjs/ai'
import type { HasTools, AnyTool } from '@rudderjs/ai'

export class ${className} extends Agent implements HasTools {
  instructions(): string {
    return 'You are a helpful assistant.'
  }

  // model(): string | undefined { return 'anthropic/claude-sonnet-4-5' }

  tools(): AnyTool[] {
    return []
  }
}
`,
}
