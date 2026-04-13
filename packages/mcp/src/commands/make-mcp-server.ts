import type { MakeSpec } from '@rudderjs/rudder'

export const makeMcpServerSpec: MakeSpec = {
  command:     'make:mcp-server',
  description: 'Create a new MCP server class',
  label:       'MCP server created',
  suffix:      'Server',
  directory:   'app/Mcp/Servers',
  stub: (className) => `import { McpServer } from '@rudderjs/mcp'
import { Name, Version, Instructions } from '@rudderjs/mcp'

@Name('${className.replace(/Server$/, '')} Server')
@Version('1.0.0')
@Instructions('Provide a description of this MCP server.')
export class ${className} extends McpServer {
  protected tools = [
    // Add your tool classes here
  ]

  protected resources = [
    // Add your resource classes here
  ]

  protected prompts = [
    // Add your prompt classes here
  ]
}
`,
}
