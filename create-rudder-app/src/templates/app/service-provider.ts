import type { TemplateContext } from '../../templates.js'

export function appServiceProvider(ctx: TemplateContext): string {
  const imports: string[] = ["import { ServiceProvider } from '@rudderjs/core'"]
  const registerLines: string[] = [
    '// Register your application-level services here:',
    '// this.app.singleton(MyService, () => new MyService())',
  ]

  if (ctx.packages.mcp) {
    imports.push("import { Mcp } from '@rudderjs/mcp'")
    imports.push("import { EchoServer } from '../Mcp/EchoServer.js'")
    registerLines.push('')
    registerLines.push('// Expose the demo MCP server over HTTP at /mcp/echo')
    registerLines.push("Mcp.web('/mcp/echo', EchoServer)")
  }

  return `${imports.join('\n')}

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    ${registerLines.join('\n    ')}
  }

  boot(): void {
    console.log(\`[AppServiceProvider] booted — \${this.app.name}\`)
  }
}
`
}
