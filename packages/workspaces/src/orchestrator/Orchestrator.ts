import {
  agent,
  MemoryConversationStore,
  type AnyTool,
  type AiMessage,
  type AiMiddleware,
  type AgentResponse,
  type AgentStreamResponse,
  type StreamChunk,
} from '@rudderjs/ai'
import { createDepartmentTool } from './DepartmentTool.js'
import type { CanvasNode } from '../canvas/CanvasNode.js'

// ─── Options ─────────────────────────────────────────────

export interface OrchestratorOptions {
  /** Workspace name (used in system prompt) */
  name: string
  /** Flat node map from workspace */
  nodes: Map<string, CanvasNode>
  /** AI model for the orchestrator (default: registry default) */
  model?: string | undefined
  /** Additional tools available to the orchestrator */
  tools?: AnyTool[] | undefined
  /** Additional middleware (e.g. broadcastMiddleware) */
  middleware?: AiMiddleware[] | undefined
}

// ─── Response types ──────────────────────────────────────

export interface OrchestratorResponse extends AgentResponse {
  conversationId: string
}

export interface OrchestratorStreamResponse {
  stream: AsyncIterable<StreamChunk>
  response: Promise<OrchestratorResponse>
}

// ─── Orchestrator ────────────────────────────────────────

/**
 * Multi-agent orchestrator — receives user messages, routes to departments,
 * delegates to department agents, and synthesizes responses.
 *
 * @example
 * const orchestrator = new Orchestrator({
 *   name: 'Sales Workspace',
 *   nodes: workspaceNodes,
 * })
 *
 * // Non-streaming
 * const response = await orchestrator.prompt('How can we improve sales?')
 *
 * // Streaming
 * const { stream } = orchestrator.stream('Analyze our pipeline')
 * for await (const chunk of stream) {
 *   if (chunk.type === 'text-delta') process.stdout.write(chunk.text!)
 * }
 *
 * // Continue conversation
 * const followUp = await orchestrator.prompt('Tell me more', response.conversationId)
 */
export class Orchestrator {
  private readonly options: OrchestratorOptions
  private readonly conversations = new MemoryConversationStore()

  constructor(options: OrchestratorOptions) {
    this.options = options
  }

  /** Send a message and get a complete response */
  async prompt(input: string, conversationId?: string): Promise<OrchestratorResponse> {
    const convId = conversationId ?? await this.conversations.create(input.slice(0, 50))
    const history = conversationId ? await this.conversations.load(convId) : []

    const a = this.buildAgent(history)
    const response = await a.prompt(input)

    await this.conversations.append(convId, [
      { role: 'user', content: input },
      { role: 'assistant', content: response.text },
    ])

    return { ...response, conversationId: convId }
  }

  /** Send a message and stream the response */
  stream(input: string, conversationId?: string): OrchestratorStreamResponse {
    let resolveOuter: (r: OrchestratorResponse) => void
    const outerPromise = new Promise<OrchestratorResponse>((r) => { resolveOuter = r })

    const self = this

    async function* generateStream(): AsyncIterable<StreamChunk> {
      const convId = conversationId ?? await self.conversations.create(input.slice(0, 50))
      const history = conversationId ? await self.conversations.load(convId) : []

      const a = self.buildAgent(history)
      const { stream, response } = a.stream(input)

      for await (const chunk of stream) {
        yield chunk
      }

      const final = await response

      await self.conversations.append(convId, [
        { role: 'user', content: input },
        { role: 'assistant', content: final.text },
      ])

      resolveOuter!({ ...final, conversationId: convId })
    }

    return {
      stream: generateStream(),
      response: outerPromise,
    }
  }

  /** Get the conversation store for direct access */
  getConversations(): MemoryConversationStore {
    return this.conversations
  }

  // ─── Internal ────────────────────────────────────────

  private buildAgent(history: AiMessage[] = []) {
    const departmentTool = createDepartmentTool(this.options.nodes)
    const tools: AnyTool[] = [departmentTool, ...(this.options.tools ?? [])]

    // Collect department names for system prompt
    const deptNames: string[] = []
    for (const node of this.options.nodes.values()) {
      if (node.type === 'department') {
        deptNames.push(node.props.name as string)
      }
    }

    const instructions = [
      `You are the orchestrator for the "${this.options.name}" workspace.`,
      deptNames.length > 0
        ? `You have access to ${deptNames.length} department(s): ${deptNames.join(', ')}.`
        : 'No departments are configured yet.',
      'When a user asks something, analyze the request and delegate to the appropriate department(s) using the invoke_department tool.',
      'You can call multiple departments for complex tasks that span domains.',
      'After receiving department responses, synthesize them into a clear, helpful answer for the user.',
      'If no department is relevant, answer directly from your own knowledge.',
    ].join('\n')

    return agent({
      instructions,
      tools,
      model: this.options.model,
      middleware: this.options.middleware,
    })
  }
}
