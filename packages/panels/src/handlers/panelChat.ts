import type { AppRequest, AppResponse, MiddlewareHandler } from '@boostkit/core'
import type { Panel } from '../Panel.js'
import type { Resource } from '../Resource.js'
import type { ResourceAgent, ResourceAgentContext } from '../agents/ResourceAgent.js'
import type { ModelClass, RecordRow } from '../types.js'
import { buildContext } from './utils.js'

// ─── Lazy AI import ─────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
let _ai: { agent: any; toolDefinition: any; z: any } | undefined

async function loadAi() {
  if (!_ai) {
    const ai  = await import(/* @vite-ignore */ '@boostkit/ai') as any
    const zod = await import(/* @vite-ignore */ 'zod') as any
    _ai = { agent: ai.agent, toolDefinition: ai.toolDefinition, z: zod.z }
  }
  return _ai!
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ─── Types ──────────────────────────────────────────────────

interface ChatRequestBody {
  message:          string
  history?:         Array<{ role: 'user' | 'assistant'; content: string }>
  resourceContext?: { resourceSlug: string; recordId: string }
  forceAgent?:      string
}

// ─── SSE helpers ────────────────────────────────────────────

type SSESend = (event: string, data: unknown) => void

function createSSEStream() {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array>

  const readable = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
  })

  const send: SSESend = (event, data) => {
    try {
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    } catch { /* stream closed */ }
  }

  const close = () => {
    try { controller.close() } catch { /* already closed */ }
  }

  return { readable, send, close }
}

// ─── Force-agent path (bypass AI, run agent directly) ───────

async function handleForceAgent(
  send: SSESend,
  close: () => void,
  agentDef: ResourceAgent,
  agentCtx: ResourceAgentContext,
  input: string,
) {
  send('agent_start', { agentSlug: agentDef.getSlug(), agentLabel: (agentDef as any)._label })

  try {
    const { stream, response } = await agentDef.stream(agentCtx, input)

    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text-delta':
          if (chunk.text) send('text', { text: chunk.text })
          break
        case 'tool-call':
          send('tool_call', { tool: chunk.toolCall?.name, input: chunk.toolCall?.arguments })
          break
      }
    }

    const result = await response
    send('agent_complete', { steps: result.steps.length, tokens: result.usage?.totalTokens ?? 0 })
    send('complete', { done: true })
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : 'Agent run failed.' })
  } finally {
    close()
  }
}

// ─── AI chat path (with run_agent tool) ─────────────────────

async function handleAiChat(
  send: SSESend,
  close: () => void,
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  agents: ResourceAgent[],
  agentCtx: ResourceAgentContext,
  record: Record<string, unknown>,
) {
  const { agent: agentFn, toolDefinition, z } = await loadAi()

  // Build system prompt with resource context
  const agentList = agents.map(a => `- "${(a as any)._label}" (slug: ${a.getSlug()}) — fields: ${(a as any)._fields.join(', ')}`).join('\n')
  const systemPrompt = [
    'You are a helpful AI assistant for an admin panel.',
    '',
    '## Current Record',
    '```json',
    JSON.stringify(record, null, 2),
    '```',
    '',
    '## Available Agents',
    agentList,
    '',
    'If the user\'s request maps to one of the available agents, call the `run_agent` tool with the agent slug.',
    'Otherwise, respond conversationally.',
    'Be concise and helpful.',
  ].join('\n')

  // Build the run_agent tool
  const slugs = agents.map(a => a.getSlug())
  const runAgentTool = toolDefinition({
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
            // Don't relay inner agent text as outer text — it would confuse the conversation
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

  // Build conversation messages for the AI
  const messages = history.map(h => ({
    role: h.role as 'user' | 'assistant',
    content: h.content,
  }))

  try {
    const a = agentFn({
      instructions: systemPrompt,
      tools: [runAgentTool],
    })

    const { stream, response } = a.stream(message)

    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text-delta':
          if (chunk.text) send('text', { text: chunk.text })
          break
        case 'tool-call':
          // run_agent tool calls are handled by the tool server fn above
          break
      }
    }

    const result = await response
    send('complete', { done: true, usage: result.usage, steps: result.steps.length })
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : 'Chat failed.' })
  } finally {
    close()
  }
}

// ─── Main handler ───────────────────────────────────────────

async function handlePanelChat(
  req: AppRequest,
  res: AppResponse,
  panel: Panel,
): Promise<unknown> {
  // Parse body
  let body: ChatRequestBody
  try {
    body = req.body as ChatRequestBody
    if (!body?.message) {
      return res.status(400).json({ message: 'Missing "message" field.' })
    }
  } catch {
    return res.status(400).json({ message: 'Invalid request body.' })
  }

  const { message, history = [], resourceContext, forceAgent } = body

  // Create SSE stream
  const { readable, send, close } = createSSEStream()

  // If resource context, load the resource + record
  let agents: ResourceAgent[] = []
  let agentCtx: ResourceAgentContext | undefined
  let record: Record<string, unknown> = {}

  if (resourceContext) {
    const ResourceClass = panel.getResources().find(R => R.getSlug() === resourceContext.resourceSlug)
    if (!ResourceClass) {
      return res.status(404).json({ message: `Resource "${resourceContext.resourceSlug}" not found.` })
    }

    const resource = new ResourceClass()
    const ctx = buildContext(req)
    if (!await resource.policy('view', ctx)) {
      return res.status(403).json({ message: 'Forbidden.' })
    }

    const Model = ResourceClass.model as ModelClass<RecordRow> | undefined
    if (Model) {
      const raw = await Model.find(resourceContext.recordId)
      if (raw) {
        record = typeof (raw as any).toJSON === 'function' ? (raw as any).toJSON() : raw as Record<string, unknown>
      }
    }

    agents = resource.agents()
    agentCtx = {
      record,
      resourceSlug: resourceContext.resourceSlug,
      recordId: resourceContext.recordId,
      panelSlug: panel.getName(),
    }
  }

  // Start streaming in background
  if (forceAgent && agentCtx) {
    const targetAgent = agents.find(a => a.getSlug() === forceAgent)
    if (!targetAgent) {
      return res.status(404).json({ message: `Agent "${forceAgent}" not found.` })
    }
    // Don't await — stream runs asynchronously
    handleForceAgent(send, close, targetAgent, agentCtx, message)
  } else if (agents.length > 0 && agentCtx) {
    handleAiChat(send, close, message, history, agents, agentCtx, record)
  } else {
    // No resource context — simple AI chat (no tools)
    const { agent: agentFn } = await loadAi()
    const a = agentFn('You are a helpful assistant for an admin panel. Be concise.')
    const { stream, response } = a.stream(message);

    (async () => {
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta' && chunk.text) {
            send('text', { text: chunk.text })
          }
        }
        const result = await response
        send('complete', { done: true, usage: result.usage })
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : 'Chat failed.' })
      } finally {
        close()
      }
    })()
  }

  // Return SSE response via raw Hono context
  const c = res.raw as { header(key: string, value: string): void; res: unknown }
  c.res = new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
  return c.res
}

// ─── Mount helper ───────────────────────────────────────────

export function mountPanelChat(
  router: {
    post(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
  },
  panel: Panel,
  mw: MiddlewareHandler[],
) {
  const base = panel.getPath()
  router.post(`${base}/api/_chat`, async (req, res) => {
    return handlePanelChat(req, res, panel)
  }, mw)
}
