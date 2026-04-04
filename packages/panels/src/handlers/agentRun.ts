import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { Resource } from '../Resource.js'
import type { ResourceAgent, ResourceAgentContext } from '../agents/ResourceAgent.js'
import type { ModelClass, RecordRow } from '../types.js'
import { buildContext } from './utils.js'

/**
 * SSE streaming handler for running a ResourceAgent against a record.
 *
 * `POST /{panel}/api/{resource}/:id/_agents/:agentSlug`
 *
 * The response is `text/event-stream` — each event maps from the AI SDK's
 * `StreamChunk.type` to a panel-specific SSE event:
 *
 *   text-delta  → event: text
 *   tool-call   → event: tool_call
 *   finish      → event: complete
 */
export async function handleAgentRun(
  req: AppRequest,
  res: AppResponse,
  ResourceClass: typeof Resource,
  panelSlug: string,
): Promise<unknown> {
  const id        = (req.params as Record<string, string>)['id'] ?? ''
  const agentSlug = (req.params as Record<string, string>)['agentSlug'] ?? ''

  // ── Auth ──────────────────────────────────────────────
  const resource = new ResourceClass()
  const ctx      = buildContext(req)
  if (!await resource.policy('update', ctx)) {
    return res.status(403).json({ message: 'Forbidden.' })
  }

  // ── Validate model ────────────────────────────────────
  const Model = ResourceClass.model as ModelClass<RecordRow> | undefined
  if (!Model) {
    return res.status(500).json({ message: `Resource "${ResourceClass.getSlug()}" has no model.` })
  }

  // ── Find agent ────────────────────────────────────────
  const agents = resource.agents()
  const agentDef = agents.find(a => a.getSlug() === agentSlug)
  if (!agentDef) {
    return res.status(404).json({ message: `Agent "${agentSlug}" not found.` })
  }

  // ── Load record ───────────────────────────────────────
  const record = await Model.find(id)
  if (!record) {
    return res.status(404).json({ message: 'Record not found.' })
  }

  // ── Parse optional user input ─────────────────────────
  let input: string | undefined
  try {
    const body = req.body as Record<string, unknown> | undefined
    if (body && typeof body['input'] === 'string') {
      input = body['input']
    }
  } catch { /* no body */ }

  // ── Build agent context ───────────────────────────────
  const agentCtx: ResourceAgentContext = {
    record:       typeof (record as any).toJSON === 'function' ? (record as any).toJSON() : record as Record<string, unknown>,
    resourceSlug: ResourceClass.getSlug(),
    recordId:     id,
    panelSlug,
  }

  // ── Stream SSE ────────────────────────────────────────
  try {
    const { stream, response } = await agentDef.stream(agentCtx, input)

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }

        try {
          for await (const chunk of stream) {
            switch (chunk.type) {
              case 'text-delta':
                if (chunk.text) send('text', { text: chunk.text })
                break
              case 'tool-call':
                if (chunk.toolCall?.name === 'edit_text') {
                  send('client_tool_call', { tool: chunk.toolCall.name, input: chunk.toolCall.arguments })
                } else {
                  send('tool_call', { tool: chunk.toolCall?.name, input: chunk.toolCall?.arguments })
                }
                break
              case 'tool-call-delta':
                // Skip partial tool call deltas — we emit the final tool-call
                break
              case 'finish':
                // Handled after the loop
                break
            }
          }

          const result = await response
          send('complete', {
            text: result.text,
            usage: result.usage,
            steps: result.steps.length,
          })
        } catch (err) {
          send('error', { message: err instanceof Error ? err.message : 'Agent run failed.' })
        } finally {
          controller.close()
        }
      },
    })

    // Use the raw Hono Context to return a streaming response
    const c = res.raw as {
      header(key: string, value: string): void
      res: unknown
    }
    c.res = new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
    return c.res
  } catch (err) {
    return res.status(500).json({
      message: err instanceof Error ? err.message : 'Failed to start agent.',
    })
  }
}
