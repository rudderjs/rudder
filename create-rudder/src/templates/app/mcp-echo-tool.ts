export function mcpEchoTool(): string {
  return `import { z } from 'zod'
import { McpTool, McpResponse, Description } from '@rudderjs/mcp'
import type { McpToolResult } from '@rudderjs/mcp'

@Description('Echoes the given message back to the caller')
export class EchoTool extends McpTool {
  schema() {
    return z.object({
      message: z.string().describe('The message to echo'),
    })
  }

  async handle(input: Record<string, unknown>): Promise<McpToolResult> {
    return McpResponse.text(\`Echo: \${String(input['message'])}\`)
  }
}
`
}
