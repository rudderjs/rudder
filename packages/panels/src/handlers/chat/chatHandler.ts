import type { AppRequest, AppResponse } from '@rudderjs/core'
import type { Panel } from '../../Panel.js'
import type { ResourceAgent, ResourceAgentContext } from '../../agents/ResourceAgent.js'
import type { ModelClass, RecordRow } from '../../types.js'
import type { ChatRequestBody, SSESend, ConversationStoreLike } from './types.js'
import { extractUserId, resolveConversationStore, createSSEStream } from './types.js'
import { loadAi, loadLive } from './lazyImports.js'
import { buildRunAgentTool } from './tools/runAgentTool.js'
import { buildEditTextTool } from './tools/editTextTool.js'
import { generateConversationTitle } from './conversationManager.js'
import { buildContext } from '../shared/context.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

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

// ─── AI chat path (with run_agent + edit_text tools) ────────

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
  const { agent: agentFn } = await loadAi()

  // Build system prompt
  const hasAgents = agents.length > 0
  const agentList = agents.map(a => `- "${(a as any)._label}" (slug: ${a.getSlug()}) — fields: ${(a as any)._fields.join(', ')}`).join('\n')
  const systemPrompt = selection
    ? [
      'You are an AI assistant that edits text fields in an admin panel.',
      '',
      `## ACTIVE SELECTION — "${selection.field}" field`,
      'The user selected this text:',
      '"""',
      selection.text,
      '"""',
      '',
      'INSTRUCTIONS:',
      `1. You MUST call the \`edit_text\` tool to apply changes. Do NOT just respond with text.`,
      `2. The field is "${selection.field}" — do NOT touch any other field.`,
      '3. Use a replace operation where search is the selected text (or a unique substring) and replace is the new text.',
      '4. After calling the tool, briefly confirm what you changed.',
    ].join('\n')
    : [
      'You are a helpful AI assistant for an admin panel.',
      '',
      '## Current Record (LIVE — always trust this over conversation history)',
      'This data is freshly loaded and reflects the latest state, including edits made by the user or other agents since your last response.',
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

  // Collect editable fields
  const agentFieldNames = new Set(agents.flatMap(a => (a as any)._fields as string[]))
  const metaFieldNames = agentCtx.fieldMeta ? Object.keys(agentCtx.fieldMeta) : []
  const candidateFields = [...new Set([...agentFieldNames, ...metaFieldNames])]
  const allFields = candidateFields.filter(name => {
    const meta = agentCtx.fieldMeta?.[name]
    if (!meta) return true
    return !meta.readonly && !meta.hiddenFromEdit
  })

  // Build tools
  const runAgentTool = await buildRunAgentTool(agents, agentCtx, message, send)
  const editTextTool = await buildEditTextTool(agentCtx, allFields, record, selection)
  const tools = [...(runAgentTool ? [runAgentTool] : []), ...(editTextTool ? [editTextTool] : [])]

  // Build history
  const aiHistory = history.map(h => ({
    role: h.role as 'user' | 'assistant',
    content: h.content,
  }))

  const effectiveMessage = (aiHistory.length > 0 && !selection && Object.keys(record).length > 0)
    ? `${message}\n\n[Current record state: ${JSON.stringify(record)}]`
    : message

  try {
    const a = agentFn({
      instructions: systemPrompt,
      tools,
      model,
    })

    const { stream, response } = a.stream(effectiveMessage, {
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

    // Persist messages
    if (conversationId) {
      const store = await resolveConversationStore()
      if (store) {
        await store.append(conversationId, [
          { role: 'user', content: message },
          { role: 'assistant', content: assistantText || result.text },
        ])
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

// ─── Main handler ───────────────────────────────────────────

export async function handlePanelChat(
  req: AppRequest,
  res: AppResponse,
  panel: Panel,
): Promise<unknown> {
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

  const { readable, send, close } = createSSEStream()

  // Resolve conversation store
  let store: ConversationStoreLike | null = null
  try { store = await resolveConversationStore() } catch { /* no store */ }
  let conversationId = reqConvId
  let loadedHistory: Array<{ role: string; content: string }> = []

  if (store) {
    try {
      if (conversationId) {
        if (!selection) {
          const msgs = await store.load(conversationId)
          loadedHistory = msgs.map(m => ({ role: m.role, content: m.content }))
        }
      } else {
        const meta: { userId?: string | undefined; resourceSlug?: string | undefined; recordId?: string | undefined } = {}
        const reqUserId = extractUserId(req)
        if (reqUserId) meta.userId = reqUserId
        if (resourceContext?.resourceSlug) meta.resourceSlug = resourceContext.resourceSlug
        if (resourceContext?.recordId) meta.recordId = resourceContext.recordId
        conversationId = await store.create(undefined, meta)
      }
      send('conversation', { conversationId, isNew: !reqConvId })
    } catch {
      store = null
    }
  }
  if (!store && history.length > 0) {
    loadedHistory = history
  }

  // Load resource context
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

    // Overlay unsaved Yjs fields
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
      for (const [fieldName, meta] of Object.entries(fieldMeta)) {
        if (!meta.yjs) continue
        if (meta.type !== 'richcontent' && meta.type !== 'textarea' && meta.type !== 'text') continue
        try {
          const fragment = meta.type === 'richcontent' ? 'richcontent' : 'text'
          const text = Live.readText(`${docName}:${fragment}:${fieldName}`)
          if (text) record[fieldName] = text
        } catch { /* room may not exist */ }
      }
    } catch { /* Live not available */ }

    agents = resource.agents()
    agentCtx = {
      record,
      resourceSlug: resourceContext.resourceSlug,
      recordId: resourceContext.recordId,
      panelSlug: panel.getName(),
      fieldMeta: resource.getFieldMeta(),
    }
  }

  // Start streaming
  if (forceAgent && agentCtx) {
    const targetAgent = agents.find(a => a.getSlug() === forceAgent)
    if (!targetAgent) {
      return res.status(404).json({ message: `Agent "${forceAgent}" not found.` })
    }
    handleForceAgent(send, close, targetAgent, agentCtx, message)
  } else if (agentCtx) {
    handleAiChat(send, close, message, loadedHistory, agents, agentCtx, record, conversationId, requestedModel, selection)
  } else {
    // No resource context — simple AI chat
    const { agent: agentFn } = await loadAi()

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

  // Return SSE response
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

/* eslint-enable @typescript-eslint/no-explicit-any */
