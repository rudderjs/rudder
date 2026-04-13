import type { MakeSpec } from '@rudderjs/rudder'

export const makeMcpToolSpec: MakeSpec = {
  command:     'make:mcp-tool',
  description: 'Create a new MCP tool class',
  label:       'MCP tool created',
  suffix:      'Tool',
  directory:   'app/Mcp/Tools',
  stub: (className) => `import { McpTool, McpResponse, Description } from '@rudderjs/mcp'
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
`,
}
