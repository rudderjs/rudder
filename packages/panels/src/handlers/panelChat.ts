import type { AppRequest, AppResponse, MiddlewareHandler } from '@rudderjs/core'
import type { Panel } from '../Panel.js'
import type { Resource } from '../Resource.js'
import type { ResourceAgent, ResourceAgentContext } from '../agents/ResourceAgent.js'
import type { ModelClass, RecordRow } from '../types.js'
import { buildContext } from './utils.js'

// ─── Lazy imports ──────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
let _ai: { agent: any; toolDefinition: any; z: any } | undefined

async function loadAi() {
  if (!_ai) {
    const ai  = await import(/* @vite-ignore */ '@rudderjs/ai') as any
    const zod = await import(/* @vite-ignore */ 'zod') as any
    _ai = { agent: ai.agent, toolDefinition: ai.toolDefinition, z: zod.z }
  }
  return _ai!
}

async function loadLive() {
  const mod = await import(/* @vite-ignore */ '@rudderjs/live') as any
  return mod.Live as {
    readMap(docName: string, mapName: string): Record<string, unknown>
    readText(docName: string): string
    updateMap(docName: string, mapName: string, field: string, value: unknown): Promise<void>
    editText(docName: string, operation: unknown, aiCursor?: { name: string; color: string }): boolean
    editBlock(docName: string, blockType: string, blockIndex: number, field: string, value: unknown): boolean
    clearAiAwareness(docName: string): void
  }
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
    'If the user asks to edit, replace, insert, or delete specific text in a field, use the `edit_text` tool directly.',
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

  // Collect all unique field names from agents for the edit_text tool
  const allFields = [...new Set(agents.flatMap(a => (a as any)._fields as string[]))]

  // Build edit_text tool — allows direct surgical edits without going through a named agent
  const Live = await loadLive()
  const editTextTool = allFields.length > 0 ? toolDefinition({
    name: 'edit_text',
    description: [
      'Surgically edit text in a field. Use for replacing specific words, inserting text, or deleting text.',
      'Available fields: ' + allFields.join(', '),
    ].join(' '),
    inputSchema: z.object({
      field: z.enum(allFields as [string, ...string[]]),
      operations: z.array(z.union([
        z.object({
          type: z.literal('replace'),
          search: z.string().describe('Exact text to find'),
          replace: z.string().describe('Replacement text'),
        }),
        z.object({
          type: z.literal('insert_after'),
          search: z.string().describe('Text to find — new text inserted after it'),
          text: z.string().describe('Text to insert'),
        }),
        z.object({
          type: z.literal('delete'),
          search: z.string().describe('Exact text to delete'),
        }),
      ])),
    }),
  }).server(async (input: { field: string; operations: Array<Record<string, unknown>> }) => {
    const fieldInfo = agentCtx!.fieldMeta?.[input.field]
    const isCollab = fieldInfo?.yjs === true
    const docName = `panel:${agentCtx!.resourceSlug}:${agentCtx!.recordId}`

    if (isCollab) {
      const fragment = fieldInfo.type === 'richcontent' ? 'richcontent' : 'text'
      const fieldDocName = `${docName}:${fragment}:${input.field}`
      const aiCursor = { name: 'AI Assistant', color: '#8b5cf6' }

      let applied = 0
      for (const op of input.operations) {
        if (Live.editText(fieldDocName, op as any, aiCursor)) applied++
      }
      setTimeout(() => Live.clearAiAwareness(fieldDocName), 2000)
      return `Applied ${applied}/${input.operations.length} edit(s) to "${input.field}"`
    } else {
      let current = String(record[input.field] ?? '')
      try {
        const yjsFields = Live.readMap(docName, 'fields')
        if (yjsFields[input.field] != null) current = String(yjsFields[input.field])
      } catch { /* */ }

      for (const op of input.operations) {
        const search = op.search as string
        if (op.type === 'replace' && search) current = current.replace(search, op.replace as string)
        else if (op.type === 'insert_after' && search) {
          const idx = current.indexOf(search)
          if (idx !== -1) current = current.slice(0, idx + search.length) + (op.text as string) + current.slice(idx + search.length)
        }
        else if (op.type === 'delete' && search) current = current.replace(search, '')
      }
      await Live.updateMap(docName, 'fields', input.field, current)
      return `Updated "${input.field}" successfully`
    }
  }) : null

  // Build conversation messages for the AI
  const messages = history.map(h => ({
    role: h.role as 'user' | 'assistant',
    content: h.content,
  }))

  const tools = [runAgentTool, ...(editTextTool ? [editTextTool] : [])]

  try {
    const a = agentFn({
      instructions: systemPrompt,
      tools,
    })

    const { stream, response } = a.stream(message)

    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text-delta':
          if (chunk.text) send('text', { text: chunk.text })
          break
        case 'tool-call':
          // All tools are server-side now (edit_text, run_agent)
          send('tool_call', { tool: chunk.toolCall?.name, input: chunk.toolCall?.arguments })
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

    // Overlay unsaved Yjs fields on top of the DB record so agents see latest edits
    const fieldMeta = resource.getFieldMeta()
    try {
      const Live = await loadLive()
      const docName = `panel:${resourceContext.resourceSlug}:${resourceContext.recordId}`
      const yjsFields = Live.readMap(docName, 'fields')
      for (const [key, value] of Object.entries(yjsFields)) {
        if (!key.startsWith('__agent:') && value != null) {
          record[key] = value
        }
      }
      // Read text from collaborative richcontent/text fields (separate Y.Doc rooms)
      for (const [fieldName, meta] of Object.entries(fieldMeta)) {
        if (!meta.yjs) continue
        if (meta.type !== 'richcontent' && meta.type !== 'textarea') continue
        try {
          const fragment = meta.type === 'richcontent' ? 'richcontent' : 'text'
          const text = Live.readText(`${docName}:${fragment}:${fieldName}`)
          if (text) record[fieldName] = text
        } catch { /* room may not exist */ }
      }
    } catch { /* Live not available — use DB record only */ }

    agents = resource.agents()
    agentCtx = {
      record,
      resourceSlug: resourceContext.resourceSlug,
      recordId: resourceContext.recordId,
      panelSlug: panel.getName(),
      fieldMeta: resource.getFieldMeta(),
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
