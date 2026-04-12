import type { McpServer } from './McpServer.js'

type ServerClass = new () => McpServer

export interface McpWebEntry {
  server: ServerClass
  middleware: unknown[]
}

export interface McpWebBuilder {
  /** Add middleware to this web MCP endpoint */
  middleware(mw: unknown[]): McpWebBuilder
}

export class Mcp {
  private static webServers: Map<string, McpWebEntry> = new Map()
  private static localServers: Map<string, ServerClass> = new Map()

  /** Register an MCP server on an HTTP endpoint (Streamable HTTP transport) */
  static web(path: string, server: ServerClass, middleware: unknown[] = []): McpWebBuilder {
    const entry: McpWebEntry = { server, middleware }
    this.webServers.set(path, entry)
    const builder: McpWebBuilder = {
      middleware(mw: unknown[]) {
        entry.middleware.push(...mw)
        return builder
      },
    }
    return builder
  }

  /** Register an MCP server as a local CLI command (stdio transport) */
  static local(name: string, server: ServerClass): void {
    this.localServers.set(name, server)
  }

  static getWebServers(): Map<string, McpWebEntry> { return this.webServers }
  static getLocalServers(): Map<string, ServerClass> { return this.localServers }
}
