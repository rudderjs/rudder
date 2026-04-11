import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import { McpPrompt, Description } from '@rudderjs/mcp'
import type { McpPromptMessage } from '@rudderjs/mcp'
import { z } from 'zod'

@Description('Describe what this prompt does.')
export class ${className} extends McpPrompt {
  arguments() {
    return z.object({
      // Define your prompt arguments here
    })
  }

  async handle(args: Record<string, unknown>): Promise<McpPromptMessage[]> {
    return [
      { role: 'user', content: 'Summarize the following data...' },
    ]
  }
}
`
}

export function makeMcpPrompt(program: Command): void {
  registerMake(program, {
    command:     'make:mcp-prompt',
    description: 'Create a new MCP prompt class',
    label:       'MCP prompt created',
    suffix:      'Prompt',
    directory:   'app/Mcp/Prompts',
    stub,
  })
}
