import type { PanelAgent, PanelAgentContext } from '../../../agents/PanelAgent.js'
import type { SSESend } from '../types.js'
import { loadAi } from '../lazyImports.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function buildRunAgentTool(
  agents: PanelAgent[],
  agentCtx: PanelAgentContext,
  message: string,
  send: SSESend,
) {
  const slugs = agents.map(a => a.getSlug())
  if (slugs.length === 0) return null

  const { toolDefinition, z } = await loadAi()

  return toolDefinition({
    name: 'run_agent',
    description: 'Run a resource agent. Available agents: ' + slugs.join(', '),
    inputSchema: z.object({
      agentSlug: z.enum(slugs as [string, ...string[]]),
    }),
  }).server(async (input: { agentSlug: string }) => {
    const targetAgent = agents.find(a => a.getSlug() === input.agentSlug)
    if (!targetAgent) return 'Agent not found.'

    send('agent_start', { agentSlug: targetAgent.getSlug(), agentLabel: (targetAgent as any)._label })

    try {
      const { stream: agentStream, response: agentResponse } = await targetAgent.stream(agentCtx, message)

      for await (const chunk of agentStream) {
        switch (chunk.type) {
          case 'text-delta':
            break
          case 'tool-call':
            send('tool_call', { tool: chunk.toolCall?.name, input: chunk.toolCall?.arguments })
            break
        }
      }

      const result = await agentResponse
      send('agent_complete', { steps: result.steps.length, tokens: result.usage?.totalTokens ?? 0 })
      return `Agent "${(targetAgent as any)._label}" completed successfully. ${result.text}`
    } catch (err) {
      send('error', { message: err instanceof Error ? err.message : 'Agent run failed.' })
      return `Agent failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    }
  })
}

/* eslint-enable @typescript-eslint/no-explicit-any */
