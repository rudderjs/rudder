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
  conversationId?:  string
  model?:           string
  history?:         Array<{ role: 'user' | 'assistant'; content: string }>
  resourceContext?: { resourceSlug: string; recordId: string }
  forceAgent?:      string
  selection?:       { field: string; text: string }
}

interface ConversationStoreLike {
  create(title?: string, meta?: { userId?: string | undefined; resourceSlug?: string | undefined; recordId?: string | undefined }): Promise<string>
  load(conversationId: string): Promise<Array<{ role: string; content: string; toolCallId?: string; toolCalls?: unknown[] }>>
  append(conversationId: string, messages: Array<{ role: string; content: string; toolCallId?: string; toolCalls?: unknown[] }>): Promise<void>
  setTitle(conversationId: string, title: string): Promise<void>
  list(userId?: string): Promise<Array<{ id: string; title: string; createdAt: Date; updatedAt?: Date }>>
  delete?(conversationId: string): Promise<void>
  listForResource?(resourceSlug: string, recordId?: string, userId?: string): Promise<Array<{ id: string; title: string; createdAt: Date; updatedAt?: Date }>>
}

async function resolveConversationStore(): Promise<ConversationStoreLike | null> {
  try {
    const { app } = await import(/* @vite-ignore */ '@rudderjs/core') as { app(): { make(k: string): unknown } }
    return app().make('ai.conversations') as ConversationStoreLike
  } catch { return null }
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
  history: Array<{ role: string; content: string }>,
  agents: ResourceAgent[],
  agentCtx: ResourceAgentContext,
  record: Record<string, unknown>,
  conversationId?: string | undefined,
  model?: string | undefined,
  selection?: { field: string; text: string } | undefined,
) {
  const { agent: agentFn, toolDefinition, z } = await loadAi()

  // Build system prompt with resource context
  const hasAgents = agents.length > 0
  const agentList = agents.map(a => `- "${(a as any)._label}" (slug: ${a.getSlug()}) — fields: ${(a as any)._fields.join(', ')}`).join('\n')
  const systemPrompt = selection
    // ── Selection-focused prompt: only show the selected text, lock to that field ──
    ? [
      'You are a helpful AI assistant for an admin panel.',
      '',
      `## ACTIVE SELECTION — "${selection.field}" field`,
      'The user selected this text:',
      '"""',
      selection.text,
      '"""',
      '',
      `Apply the user\'s request to the selected text using the \`edit_text\` tool.`,
      `The field is "${selection.field}" — do NOT touch any other field.`,
      'Use replace operations with the selected text (or a substring of it) as the search string.',
      'Be concise.',
    ].join('\n')
    // ── Normal prompt: full record context ──
    : [
      'You are a helpful AI assistant for an admin panel.',
      '',
      '## Current Record',
      '```json',
      JSON.stringify(record, null, 2),
      '```',
      '',
      ...(hasAgents ? [
        '## Available Agents',
        agentList,
        '',
        'If the user\'s request maps to one of the available agents, call the `run_agent` tool with the agent slug.',
      ] : []),
      'If the user asks to edit, replace, insert, or delete specific text in a field, use the `edit_text` tool directly.',
      '',
      '## Block editing',
      'Rich text fields may contain embedded blocks shown as `[BLOCK: type | field: "value", ...]` in the record.',
      'To update a block field, use `edit_text` with an `update_block` operation:',
      '  `{ type: "update_block", blockType: "callToAction", blockIndex: 0, field: "buttonText", value: "New Text" }`',
      'Do NOT use `replace` to edit block fields — block data is not searchable text.',
      'Do NOT use `update_field` on rich text fields — it would overwrite the entire content.',
      '',
      'Be concise and helpful.',
    ].join('\n')

  // Build the run_agent tool (only when named agents exist)
  const slugs = agents.map(a => a.getSlug())
  const runAgentTool = slugs.length > 0 ? toolDefinition({
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
  }) : null

  // Collect all editable field names from the resource's field metadata.
  // This covers ALL form fields, not just those assigned to named agents.
  const agentFieldNames = new Set(agents.flatMap(a => (a as any)._fields as string[]))
  const metaFieldNames = agentCtx.fieldMeta ? Object.keys(agentCtx.fieldMeta) : []
  const allFields = [...new Set([...agentFieldNames, ...metaFieldNames])]

  // Build edit_text tool — allows direct surgical edits without going through a named agent
  const Live = await loadLive()
  const selectionField = selection?.field

  // When selection is active, lock the tool to only the selected field.
  // This prevents the LLM from editing unrelated fields.
  const editFieldSchema = selectionField && allFields.includes(selectionField)
    ? z.literal(selectionField)
    : z.enum(allFields as [string, ...string[]])

  const editTextDescription = selectionField
    ? `Edit text in the "${selectionField}" field. The user selected specific text — your operations MUST target that text within "${selectionField}". Do NOT edit other fields.`
    : [
        'Surgically edit text or blocks in a field without replacing all content.',
        'For embedded blocks (callToAction, video, etc.) shown as [BLOCK: ...] in the record, use update_block operations.',
        'For regular text, use replace/insert_after/delete operations.',
        'Available fields: ' + allFields.join(', '),
      ].join(' ')

  const editTextTool = allFields.length > 0 ? toolDefinition({
    name: 'edit_text',
    description: editTextDescription,
    inputSchema: z.object({
      field: editFieldSchema,
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
        z.object({
          type: z.literal('update_block'),
          blockType: z.string().describe('The block type (e.g. "callToAction", "video")'),
          blockIndex: z.number().describe('0-based index if multiple blocks of the same type'),
          field: z.string().describe('The block field to update (e.g. "title", "buttonText")'),
          value: z.string().describe('The new value'),
        }),
      ])),
    }),
  }).server(async (input: { field: string; operations: Array<Record<string, unknown>> }) => {
    // When user has an active selection, force the field to the selected field
    // as a hard guarantee (in case schema validation didn't catch it).
    const targetField = selectionField && allFields.includes(selectionField) ? selectionField : input.field
    const fieldInfo = agentCtx!.fieldMeta?.[targetField]
    const isCollab = fieldInfo?.yjs === true
    const docName = `panel:${agentCtx!.resourceSlug}:${agentCtx!.recordId}`

    if (isCollab) {
      const fragment = fieldInfo.type === 'richcontent' ? 'richcontent' : 'text'
      const fieldDocName = `${docName}:${fragment}:${targetField}`
      const aiCursor = { name: 'AI Assistant', color: '#8b5cf6' }

      let applied = 0
      for (const op of input.operations) {
        if (op.type === 'update_block') {
          if (Live.editBlock(fieldDocName, op.blockType as string, (op.blockIndex as number) ?? 0, op.field as string, op.value)) applied++
        } else {
          if (Live.editText(fieldDocName, op as any, aiCursor)) applied++
        }
      }
      setTimeout(() => Live.clearAiAwareness(fieldDocName), 2000)
      return `Applied ${applied}/${input.operations.length} edit(s) to "${targetField}"`
    } else {
      let current = String(record[targetField] ?? '')
      try {
        const yjsFields = Live.readMap(docName, 'fields')
        if (yjsFields[targetField] != null) current = String(yjsFields[targetField])
      } catch { /* */ }

      for (const op of input.operations) {
        if (op.type === 'update_block') continue
        const search = op.search as string
        if (op.type === 'replace' && search) current = current.replace(search, op.replace as string)
        else if (op.type === 'insert_after' && search) {
          const idx = current.indexOf(search)
          if (idx !== -1) current = current.slice(0, idx + search.length) + (op.text as string) + current.slice(idx + search.length)
        }
        else if (op.type === 'delete' && search) current = current.replace(search, '')
      }
      await Live.updateMap(docName, 'fields', targetField, current)
      return `Updated "${targetField}" successfully`
    }
  }) : null

  const tools = [...(runAgentTool ? [runAgentTool] : []), ...(editTextTool ? [editTextTool] : [])]

  // Build structured history for the agent
  const aiHistory = history.map(h => ({
    role: h.role as 'user' | 'assistant',
    content: h.content,
  }))

  try {
    const a = agentFn({
      instructions: systemPrompt,
      tools,
      model,
    })

    const { stream, response } = a.stream(message, {
      history: aiHistory.length > 0 ? aiHistory : undefined,
    })

    let assistantText = ''
    for await (const chunk of stream) {
      switch (chunk.type) {
        case 'text-delta':
          if (chunk.text) {
            assistantText += chunk.text
            send('text', { text: chunk.text })
          }
          break
        case 'tool-call':
          send('tool_call', { tool: chunk.toolCall?.name, input: chunk.toolCall?.arguments })
          break
      }
    }

    const result = await response
    send('complete', { done: true, usage: result.usage, steps: result.steps.length })

    // Persist messages to conversation store
    if (conversationId) {
      const store = await resolveConversationStore()
      if (store) {
        await store.append(conversationId, [
          { role: 'user', content: message },
          { role: 'assistant', content: assistantText || result.text },
        ])

        // Auto-title after first exchange (fire-and-forget)
        if (aiHistory.length === 0) {
          generateConversationTitle(store, conversationId, message, assistantText || result.text).catch(() => {})
        }
      }
    }
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : 'Chat failed.' })
  } finally {
    close()
  }
}

// ─── Auto-title generation ──────────────────────────────────

async function generateConversationTitle(
  store: ConversationStoreLike,
  conversationId: string,
  userMessage: string,
  assistantMessage: string,
) {
  try {
    const { agent: agentFn } = await loadAi()
    const a = agentFn('Generate a short title (max 6 words) for this conversation. Return ONLY the title text, nothing else.')
    const result = await a.prompt(`User: ${userMessage}\nAssistant: ${assistantMessage.slice(0, 500)}`)
    const title = result.text.trim().replace(/^["']|["']$/g, '')
    if (title) await store.setTitle(conversationId, title)
  } catch { /* non-critical — title stays as default */ }
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

  const { message, conversationId: reqConvId, model: requestedModel, history = [], resourceContext, forceAgent, selection } = body

  // Create SSE stream
  const { readable, send, close } = createSSEStream()

  // Resolve conversation store + conversation
  let store: ConversationStoreLike | null = null
  try { store = await resolveConversationStore() } catch { /* no store */ }
  let conversationId = reqConvId
  let loadedHistory: Array<{ role: string; content: string }> = []

  if (store) {
    try {
      if (conversationId) {
        // Load history from DB
        const msgs = await store.load(conversationId)
        loadedHistory = msgs.map(m => ({ role: m.role, content: m.content }))
      } else {
        // Create a new conversation
        const meta: { userId?: string | undefined; resourceSlug?: string | undefined; recordId?: string | undefined } = {}
        if (resourceContext?.resourceSlug) meta.resourceSlug = resourceContext.resourceSlug
        if (resourceContext?.recordId) meta.recordId = resourceContext.recordId
        conversationId = await store.create(undefined, meta)
      }
      send('conversation', { conversationId, isNew: !reqConvId })
    } catch {
      // DB table might not exist yet — continue without persistence
      store = null
    }
  }
  if (!store && history.length > 0) {
    // No store — use client-provided history
    loadedHistory = history
  }

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
        if (meta.type !== 'richcontent' && meta.type !== 'textarea' && meta.type !== 'text') continue
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
  } else if (agentCtx) {
    // Resource context available — use AI chat with edit tools (agents optional)
    handleAiChat(send, close, message, loadedHistory, agents, agentCtx, record, conversationId, requestedModel, selection)
  } else {
    // No resource context — simple AI chat (no tools)
    const { agent: agentFn } = await loadAi()

    // Build history for the simple chat path
    const aiHistory = loadedHistory.map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }))

    const a = agentFn({
      instructions: 'You are a helpful assistant for an admin panel. Be concise.',
      model: requestedModel,
    })
    const { stream, response } = a.stream(message, {
      history: aiHistory.length > 0 ? aiHistory : undefined,
    });

    (async () => {
      try {
        let assistantText = ''
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta' && chunk.text) {
            assistantText += chunk.text
            send('text', { text: chunk.text })
          }
        }
        const result = await response
        send('complete', { done: true, usage: result.usage })

        // Persist messages
        if (conversationId && store) {
          await store.append(conversationId, [
            { role: 'user', content: message },
            { role: 'assistant', content: assistantText || result.text },
          ])
          if (aiHistory.length === 0) {
            generateConversationTitle(store, conversationId, message, assistantText || result.text).catch(() => {})
          }
        }
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
    get(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
    post(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
    delete(path: string, handler: (req: AppRequest, res: AppResponse) => unknown, mw?: MiddlewareHandler[]): void
  },
  panel: Panel,
  mw: MiddlewareHandler[],
) {
  const base = panel.getPath()

  // GET — available models
  router.get(`${base}/api/_chat/models`, async (_req, res) => {
    try {
      const { app } = await import(/* @vite-ignore */ '@rudderjs/core') as { app(): { make(k: string): unknown } }
      const registry = app().make('ai.registry') as { getModels(): Array<{ id: string; label: string }>; getDefault(): string }
      return res.json({ models: registry.getModels(), default: registry.getDefault() })
    } catch {
      return res.json({ models: [], default: '' })
    }
  }, mw)

  // POST — main chat endpoint (SSE stream)
  router.post(`${base}/api/_chat`, async (req, res) => {
    return handlePanelChat(req, res, panel)
  }, mw)

  // GET — list conversations
  router.get(`${base}/api/_chat/conversations`, async (_req, res) => {
    const store = await resolveConversationStore()
    if (!store) return res.status(404).json({ message: 'Conversation store not available.' })

    const conversations = await store.list()

    return res.json({ conversations })
  }, mw)

  // GET — load a single conversation's messages
  router.get(`${base}/api/_chat/conversations/:id`, async (req, res) => {
    const store = await resolveConversationStore()
    if (!store) return res.status(404).json({ message: 'Conversation store not available.' })

    const id = (req.params as Record<string, string>).id ?? ''
    try {
      const messages = await store.load(id)
      return res.json({ messages })
    } catch {
      return res.status(404).json({ message: 'Conversation not found.' })
    }
  }, mw)

  // DELETE — delete a conversation
  router.delete(`${base}/api/_chat/conversations/:id`, async (req, res) => {
    const store = await resolveConversationStore()
    if (!store) return res.status(404).json({ message: 'Conversation store not available.' })

    const id = (req.params as Record<string, string>).id ?? ''
    try {
      if (store.delete) await store.delete(id)
      return res.json({ ok: true })
    } catch {
      return res.status(404).json({ message: 'Conversation not found.' })
    }
  }, mw)
}
