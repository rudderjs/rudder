import { ServiceProvider } from '@rudderjs/core'
import { Mcp } from './Mcp.js'

export class McpProvider extends ServiceProvider {
  register(): void {
    this.app.instance('mcp', Mcp)
  }

  async boot(): Promise<void> {
    const webServers = Mcp.getWebServers()
    if (webServers.size > 0) {
      try {
        const { mountHttpTransport } = await import('./runtime.js')
        const { oauth2McpMiddleware, registerOAuth2Metadata } = await import('./auth/oauth2.js')

        let router: {
          get: (path: string, handler: (req: unknown, res: unknown) => unknown, middleware?: unknown[]) => unknown
        } | undefined
        try {
          const { resolveOptionalPeer } = await import('@rudderjs/core')
          const mod = await resolveOptionalPeer<{ router: typeof router }>('@rudderjs/router')
          router = mod.router
        } catch { /* no router */ }

        for (const [path, entry] of webServers) {
          const server = new entry.server()
          const middleware = [...entry.middleware]

          if (entry.oauth2) {
            middleware.unshift(oauth2McpMiddleware(path, entry.oauth2))
            if (router) registerOAuth2Metadata(router, path, entry.oauth2)
          }

          await mountHttpTransport(server, path, { middleware })
        }
      } catch {
        // router or transport not available — skip web mounting
      }
    }

    try {
      const { resolveOptionalPeer } = await import('@rudderjs/core')
      const { registerMakeSpecs } = await resolveOptionalPeer<{
        registerMakeSpecs: (...specs: unknown[]) => void
      }>('@rudderjs/rudder')
      const { makeMcpServerSpec } = await import('./commands/make-mcp-server.js')
      const { makeMcpToolSpec } = await import('./commands/make-mcp-tool.js')
      const { makeMcpResourceSpec } = await import('./commands/make-mcp-resource.js')
      const { makeMcpPromptSpec } = await import('./commands/make-mcp-prompt.js')
      registerMakeSpecs(makeMcpServerSpec, makeMcpToolSpec, makeMcpResourceSpec, makeMcpPromptSpec)
    } catch { /* rudder not available */ }

    try {
      const { rudder } = await import('@rudderjs/core')

      rudder.command('mcp:start', async (args: string[]) => {
        const name = args[0]
        const ServerClass = name != null ? Mcp.getLocalServers().get(name) : undefined
        if (!ServerClass) {
          console.error(`MCP server "${name}" not found. Available: ${[...Mcp.getLocalServers().keys()].join(', ')}`)
          process.exit(1)
        }
        const { startStdio } = await import('./runtime.js')
        await startStdio(new ServerClass())
      }).description('Start an MCP server (stdio)')

      rudder.command('mcp:list', () => {
        const web = [...Mcp.getWebServers().entries()]
        const local = [...Mcp.getLocalServers().entries()]

        if (web.length === 0 && local.length === 0) {
          console.log('No MCP servers registered.')
          return
        }

        if (web.length > 0) {
          console.log('\nWeb Servers:')
          for (const [path, { server }] of web) {
            console.log(`  ${path} -> ${server.name}`)
          }
        }

        if (local.length > 0) {
          console.log('\nLocal Servers:')
          for (const [serverName, server] of local) {
            console.log(`  ${serverName} -> ${server.name}`)
          }
        }
      }).description('List registered MCP servers')

      rudder.command('mcp:inspector', async (args: string[]) => {
        const portIdx = args.indexOf('--port')
        const port = portIdx >= 0 && args[portIdx + 1] ? Number.parseInt(args[portIdx + 1]!, 10) : 9100
        const { startInspector } = await import('./commands/inspector.js')
        await startInspector({ port })
      }).description('Launch a web UI for interactively testing registered MCP servers')
    } catch {
      // rudder not available
    }
  }
}
