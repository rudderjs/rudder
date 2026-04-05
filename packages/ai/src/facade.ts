import { AiRegistry } from './registry.js'
import { agent as agentHelper } from './agent.js'
import type { Agent } from './agent.js'
import type { AgentResponse, AnyTool, AiMiddleware, EmbeddingResult } from './types.js'

/**
 * AI facade — static entry point for quick prompts and embeddings.
 *
 * @example
 * const response = await AI.prompt('Hello')
 * const a = AI.agent('You are helpful.')
 * const result = await AI.embed('Some text')
 */
export class AI {
  /** Quick prompt with default model */
  static async prompt(input: string, options?: { model?: string | undefined }): Promise<AgentResponse> {
    const opts: { instructions: string; model?: string | undefined } = {
      instructions: 'You are a helpful assistant.',
    }
    if (options?.model) opts.model = options.model
    return agentHelper(opts).prompt(input)
  }

  /** Create an anonymous agent */
  static agent(
    instructionsOrOptions: string | {
      instructions: string
      tools?: AnyTool[] | undefined
      model?: string | undefined
      middleware?: AiMiddleware[] | undefined
    },
  ): Agent {
    return agentHelper(instructionsOrOptions)
  }

  /**
   * Generate embeddings for text.
   *
   * @example
   * const result = await AI.embed('Hello world')
   * const result = await AI.embed(['text1', 'text2'])
   * const result = await AI.embed('text', { model: 'openai/text-embedding-3-small' })
   */
  static async embed(
    input: string | string[],
    options?: { model?: string | undefined },
  ): Promise<EmbeddingResult> {
    const modelString = options?.model ?? AiRegistry.getDefault()
    const [providerName, modelId] = AiRegistry.parseModelString(modelString)
    const factory = AiRegistry.getFactory(providerName)

    if (!factory.createEmbedding) {
      throw new Error(
        `[RudderJS AI] Provider "${providerName}" does not support embeddings. ` +
        `Use a provider that implements createEmbedding() (e.g. openai).`,
      )
    }

    const adapter = factory.createEmbedding(modelId)
    return adapter.embed(input, modelId)
  }
}
