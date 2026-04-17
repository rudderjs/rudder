import type { McpServer } from './McpServer.js'
import type { McpTool, McpToolResult } from './McpTool.js'
import type { McpResource } from './McpResource.js'
import type { McpPrompt, McpPromptMessage } from './McpPrompt.js'
import { resolveHandleDeps } from './runtime.js'

export class McpTestClient {
  private tools: McpTool[]
  private resources: McpResource[]
  private prompts: McpPrompt[]

  constructor(ServerClass: new () => McpServer) {
    const server = new ServerClass()
    const record = server as unknown as Record<string, unknown>

    this.tools = (
      (record['tools'] as Array<new () => McpTool> | undefined) ?? []
    ).map((T) => new T())

    this.resources = (
      (record['resources'] as Array<new () => McpResource> | undefined) ?? []
    ).map((R) => new R())

    this.prompts = (
      (record['prompts'] as Array<new () => McpPrompt> | undefined) ?? []
    ).map((P) => new P())
  }

  async callTool(name: string, input: Record<string, unknown> = {}): Promise<McpToolResult> {
    const tool = this.tools.find((t) => t.name() === name)
    if (!tool) throw new Error(`Tool "${name}" not found`)
    const extras = resolveHandleDeps(tool, 'handle')
    return tool.handle(input, ...extras as [])
  }

  async listTools(): Promise<Array<{ name: string; description: string }>> {
    return this.tools.map((t) => ({ name: t.name(), description: t.description() }))
  }

  async listResources(): Promise<Array<{ uri: string; description: string }>> {
    return this.resources.map((r) => ({ uri: r.uri(), description: r.description() }))
  }

  async listPrompts(): Promise<Array<{ name: string; description: string }>> {
    return this.prompts.map((p) => ({ name: p.name(), description: p.description() }))
  }

  async readResource(uri: string): Promise<string> {
    const resource = this.resources.find((r) => r.uri() === uri)
    if (!resource) throw new Error(`Resource "${uri}" not found`)
    return resource.handle()
  }

  async getPrompt(name: string, args: Record<string, unknown> = {}): Promise<McpPromptMessage[]> {
    const prompt = this.prompts.find((p) => p.name() === name)
    if (!prompt) throw new Error(`Prompt "${name}" not found`)
    return prompt.handle(args)
  }

  assertToolExists(name: string): void {
    if (!this.tools.some((t) => t.name() === name)) {
      throw new Error(`Expected tool "${name}" to exist, but it was not found`)
    }
  }

  assertToolCount(expected: number): void {
    if (this.tools.length !== expected) {
      throw new Error(`Expected ${expected} tools, but found ${this.tools.length}`)
    }
  }

  assertResourceExists(uri: string): void {
    if (!this.resources.some((r) => r.uri() === uri)) {
      throw new Error(`Expected resource "${uri}" to exist, but it was not found`)
    }
  }

  assertResourceCount(expected: number): void {
    if (this.resources.length !== expected) {
      throw new Error(`Expected ${expected} resources, but found ${this.resources.length}`)
    }
  }

  assertPromptExists(name: string): void {
    if (!this.prompts.some((p) => p.name() === name)) {
      throw new Error(`Expected prompt "${name}" to exist, but it was not found`)
    }
  }

  assertPromptCount(expected: number): void {
    if (this.prompts.length !== expected) {
      throw new Error(`Expected ${expected} prompts, but found ${this.prompts.length}`)
    }
  }
}
