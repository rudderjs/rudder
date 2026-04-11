import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import { McpTool, McpResponse, Description } from '@rudderjs/mcp'
import { z } from 'zod'

@Description('Describe what this tool does.')
export class ${className} extends McpTool {
  schema() {
    return z.object({
      // Define your input parameters here
    })
  }

  async handle(input: Record<string, unknown>) {
    // Implement your tool logic here
    return McpResponse.text('Hello from ${className.replace(/Tool$/, '')}')
  }
}
`
}

export function makeMcpTool(program: Command): void {
  registerMake(program, {
    command:     'make:mcp-tool',
    description: 'Create a new MCP tool class',
    label:       'MCP tool created',
    suffix:      'Tool',
    directory:   'app/Mcp/Tools',
    stub,
  })
}
