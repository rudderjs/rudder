import { agent as agentHelper } from './agent.js'
import type { Agent } from './agent.js'
import type { AgentResponse, AnyTool, AiMiddleware } from './types.js'

/**
 * AI facade — static entry point for quick prompts.
 *
 * @example
 * const response = await AI.prompt('Hello')
 * const a = AI.agent('You are helpful.')
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
}
