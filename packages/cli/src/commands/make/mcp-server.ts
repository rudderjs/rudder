import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import { McpServer } from '@rudderjs/mcp'
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
`
}

export function makeMcpServer(program: Command): void {
  registerMake(program, {
    command:     'make:mcp-server',
    description: 'Create a new MCP server class',
    label:       'MCP server created',
    suffix:      'Server',
    directory:   'app/Mcp/Servers',
    stub,
  })
}
