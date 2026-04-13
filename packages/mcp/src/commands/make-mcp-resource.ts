import type { MakeSpec } from '@rudderjs/rudder'

export const makeMcpResourceSpec: MakeSpec = {
  command:     'make:mcp-resource',
  description: 'Create a new MCP resource class',
  label:       'MCP resource created',
  suffix:      'Resource',
  directory:   'app/Mcp/Resources',
  stub: (className) => `import { McpResource, Description } from '@rudderjs/mcp'

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
`,
}
