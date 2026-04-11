import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import { McpResource, Description } from '@rudderjs/mcp'

@Description('Describe what this resource provides.')
export class ${className} extends McpResource {
  uri(): string {
    return 'app://${className.replace(/Resource$/, '').toLowerCase()}'
  }

  mimeType(): string {
    return 'text/plain'
  }

  async handle(): Promise<string> {
    // Return resource content here
    return 'Resource content'
  }
}
`
}

export function makeMcpResource(program: Command): void {
  registerMake(program, {
    command:     'make:mcp-resource',
    description: 'Create a new MCP resource class',
    label:       'MCP resource created',
    suffix:      'Resource',
    directory:   'app/Mcp/Resources',
    stub,
  })
}
