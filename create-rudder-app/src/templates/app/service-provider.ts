import { shouldScaffoldDemo, type TemplateContext } from '../../templates.js'
import { pennantFeatureDefinitions } from '../demos/pennant.js'

export function appServiceProvider(ctx: TemplateContext): string {
  const imports: string[] = ["import { ServiceProvider } from '@rudderjs/core'"]
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

  // Demo modules that ship their own ServiceProvider need dynamic registration
  // here so their boot() runs after framework providers (DB, router, etc.).
  if (shouldScaffoldDemo(ctx, 'todos')) {
    imports.push("import { TodoServiceProvider } from '../Modules/Todo/TodoServiceProvider.js'")
    bootLines.push('await this.app.register(TodoServiceProvider)')
  }

  // Pennant demo seeds its four feature shapes (boolean/value/scoped/lottery)
  // in boot() so the /demos/pennant view can resolve them.
  if (shouldScaffoldDemo(ctx, 'pennant')) {
    imports.push("import { Feature, Lottery } from '@rudderjs/pennant'")
    bootLines.push('// Pennant demo features — see app/Views/Demos/Pennant.tsx')
    bootLines.push(pennantFeatureDefinitions())
  }

  const isAsyncBoot = bootLines.some(l => l.includes('await '))
  const bootBody = bootLines.length > 0
    ? `${bootLines.join('\n    ')}\n    console.log(\`[AppServiceProvider] booted — \${this.app.name}\`)`
    : `console.log(\`[AppServiceProvider] booted — \${this.app.name}\`)`
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
