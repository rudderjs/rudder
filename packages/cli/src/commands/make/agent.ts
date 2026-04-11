import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import { Agent } from '@rudderjs/ai'
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
`
}

export function makeAgent(program: Command): void {
  registerMake(program, {
    command:     'make:agent',
    description: 'Create a new AI agent class',
    label:       'Agent created',
    suffix:      'Agent',
    directory:   'app/Agents',
    stub,
  })
}
