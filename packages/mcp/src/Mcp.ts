import type { McpServer } from './McpServer.js'

type ServerClass = new () => McpServer

export class Mcp {
  private static webServers: Map<string, { server: ServerClass; middleware: unknown[] }> = new Map()
  private static localServers: Map<string, ServerClass> = new Map()

  /** Register an MCP server on an HTTP endpoint (Streamable HTTP transport) */
  static web(path: string, server: ServerClass, middleware: unknown[] = []): void {
    this.webServers.set(path, { server, middleware })
  }

  /** Register an MCP server as a local CLI command (stdio transport) */
  static local(name: string, server: ServerClass): void {
    this.localServers.set(name, server)
  }

  static getWebServers() { return this.webServers }
  static getLocalServers() { return this.localServers }
}
