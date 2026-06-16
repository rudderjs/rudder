import { type TemplateContext } from '../../templates.js'

export function appServiceProvider(ctx: TemplateContext): string {
  const imports: string[] = ["import { ServiceProvider, bootLine } from '@rudderjs/core'"]
  const registerLines: string[] = [
    '// Register your application-level services here:',
    '// this.app.singleton(MyService, () => new MyService())',
  ]
  const bootLines: string[] = []

  if (ctx.packages.mcp) {
    imports.push("import { Mcp } from '@rudderjs/mcp'")
    imports.push("import { EchoServer } from '../Mcp/EchoServer.js'")
    registerLines.push('')
    registerLines.push('// Expose the demo MCP server over HTTP at /mcp/echo')
    registerLines.push("Mcp.web('/mcp/echo', EchoServer)")
  }

  const isAsyncBoot = bootLines.some(l => l.includes('await '))
  // `bootLine()` prints a Vike-style `➜` line in dev that sits with the
  // framework's startup banner, and degrades to a plain line in production.
  const readyLine = 'bootLine(`${this.app.name} ready`)'
  const bootBody = bootLines.length > 0
    ? `${bootLines.join('\n    ')}\n    ${readyLine}`
    : readyLine
  const bootSig = isAsyncBoot ? 'override async boot(): Promise<void>' : 'boot(): void'

  return `${imports.join('\n')}

export class AppServiceProvider extends ServiceProvider {
  register(): void {
    ${registerLines.join('\n    ')}
  }

  ${bootSig} {
    ${bootBody}
  }
}
`
}
