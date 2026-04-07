import type { AiMessage, AnyTool, ConversationStoreMeta } from '@rudderjs/ai'
import type { ResourceAgent, ResourceAgentContext } from '../../../agents/ResourceAgent.js'
import type { ModelClass, RecordRow } from '../../../types.js'
import type { ChatContext } from './types.js'
import type { ResolveContextDeps } from './resolveContext.js'
import { ChatContextError } from './types.js'
import { extractUserId } from '../types.js'
import { buildContext } from '../../shared/context.js'
import { loadLive } from '../lazyImports.js'
import { buildRunAgentTool } from '../tools/runAgentTool.js'
import { buildEditTextTool } from '../tools/editTextTool.js'
import { buildReadFormStateTool } from '../tools/readFormStateTool.js'
import { buildDeleteRecordTool } from '../tools/deleteRecordTool.js'
import { buildBuilderCatalogPrompt } from '../blockCatalog.js'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ResolvedResourceState {
  resourceSlug:     string
  recordId:         string
  record:           Record<string, unknown>
  agents:           ResourceAgent[]
  agentCtx:         ResourceAgentContext
  forceAgent:       ResourceAgent | null
  selection:        { field: string; text: string } | undefined
  userId:           string | undefined
  tools:            AnyTool[]
  /** Pre-rendered "Available block types" section, or '' if the resource has no builder fields. */
  builderCatalog:   string
}

/**
 * Chat scoped to a single record on a resource (the record-edit page chat).
 *
 * Lifted from the old `handleAiChat` in chatHandler.ts. The async work
 * (resource lookup, policy check, record load, Yjs overlay, tool construction)
 * happens in `create()`; the synchronous methods just read from resolved state.
 */
export class ResourceChatContext implements ChatContext {
  readonly kind = 'resource' as const

  private constructor(private readonly state: ResolvedResourceState) {}

  static async create(deps: ResolveContextDeps): Promise<ResourceChatContext> {
    const { body, panel, req, send } = deps
    const ctxBody = body.resourceContext!
    const { resourceSlug, recordId } = ctxBody

    // 1. Find the resource class
    const ResourceClass = panel.getResources().find(R => R.getSlug() === resourceSlug)
    if (!ResourceClass) {
      throw new ChatContextError(404, `Resource "${resourceSlug}" not found.`)
    }

    // 2. Policy check
    const resource = new ResourceClass()
    const policyCtx = buildContext(req)
    if (!await resource.policy('view', policyCtx)) {
      throw new ChatContextError(403, 'Forbidden.')
    }

    // 3. Load the record
    let record: Record<string, unknown> = {}
    const Model = ResourceClass.model as ModelClass<RecordRow> | undefined
    if (Model) {
      const raw = await Model.find(recordId)
      if (raw) {
        record = typeof (raw as any).toJSON === 'function'
          ? (raw as any).toJSON()
          : raw as Record<string, unknown>
      }
    }

    // 4. Overlay unsaved Yjs fields (lifted verbatim from chatHandler.ts:264-282)
    const fieldMeta = resource.getFieldMeta()
    try {
      const Live = await loadLive()
      const docName = `panel:${resourceSlug}:${recordId}`
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

    // 5. Resolve agents + agentCtx
    const agents = resource.agents()
    const agentCtx: ResourceAgentContext = {
      record,
      resourceSlug,
      recordId,
      panelSlug: panel.getName(),
      fieldMeta: resource.getFieldMeta(),
    }

    // 6. Resolve forceAgent if requested
    let forceAgent: ResourceAgent | null = null
    if (body.forceAgent) {
      const target = agents.find(a => a.getSlug() === body.forceAgent)
      if (!target) {
        throw new ChatContextError(404, `Agent "${body.forceAgent}" not found.`)
      }
      forceAgent = target
    }

    // 7. Pre-build the tools (async — they import zod/ai and live)
    const message = body.message ?? ''
    const selection = body.selection

    const agentFieldNames = new Set(agents.flatMap(a => (a as any)._fields as string[]))
    const metaFieldNames = agentCtx.fieldMeta ? Object.keys(agentCtx.fieldMeta) : []
    const candidateFields = [...new Set([...agentFieldNames, ...metaFieldNames])]
    const allFields = candidateFields.filter(name => {
      const meta = agentCtx.fieldMeta?.[name]
      if (!meta) return true
      return !meta.readonly && !meta.hiddenFromEdit
    })

    const runAgentTool      = await buildRunAgentTool(agents, agentCtx, message, send)
    const editTextTool      = await buildEditTextTool(agentCtx, allFields, record, selection)
    const readFormStateTool = await buildReadFormStateTool()
    const deleteRecordTool  = Model
      ? await buildDeleteRecordTool({ Model, recordId })
      : null
    const tools: AnyTool[] = [
      ...(runAgentTool      ? [runAgentTool]      : []),
      ...(editTextTool      ? [editTextTool]      : []),
      readFormStateTool,
      ...(deleteRecordTool  ? [deleteRecordTool]  : []),
    ]

    // 8. Pre-render the builder block catalog (LSP-style structured metadata
    //    so the agent doesn't infer block types from raw Lexical JSON).
    const builderCatalog = buildBuilderCatalogPrompt(resource)

    return new ResourceChatContext({
      resourceSlug,
      recordId,
      record,
      agents,
      agentCtx,
      forceAgent,
      selection,
      userId: extractUserId(req),
      tools,
      builderCatalog,
    })
  }

  /** Used by the dispatcher's force-agent branch */
  getForceAgent(): ResourceAgent | null {
    return this.state.forceAgent
  }

  /** Used by the dispatcher's force-agent branch — reuses the resolved agentCtx */
  getAgentContext(): ResourceAgentContext {
    return this.state.agentCtx
  }

  buildSystemPrompt(): string {
    const { agents, record, selection, builderCatalog } = this.state
    const hasAgents = agents.length > 0
    const agentList = agents
      .map(a => `- "${(a as any)._label}" (slug: ${a.getSlug()}) — fields: ${(a as any)._fields.join(', ')}`)
      .join('\n')

    if (selection) {
      return [
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
    }

    return [
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
      '## Reading the user\'s in-progress edits',
      'The "Current Record" snapshot above includes saved DB values + collaborative (Yjs) field overlays — but it does NOT include unsaved edits to non-collaborative fields, which live only in the user\'s browser form state.',
      'If the user asks about a field value and the snapshot looks stale or empty, call `read_form_state` (optionally with a `fields` array) to read the live local values from the browser before answering.',
      '',
      '## Deleting records',
      'If the user asks you to delete the current record, you MUST call the `delete_record` tool immediately — do NOT ask the user for confirmation in chat. The tool itself has a built-in approval gate: the browser will show an inline Approve/Reject card on the tool call, the user clicks one, and the agent loop resumes. Asking the user "are you sure?" in plain text wastes a turn and bypasses the approval flow.',
      '',
      ...(builderCatalog ? [
        builderCatalog,
        '',
        'Do NOT use `replace` operations to edit block fields — block data is not searchable text. Do NOT use `update_field` on rich text fields — it would overwrite the entire content.',
        '',
      ] : [
        '## Block editing',
        'Rich text fields may contain embedded blocks shown as `[BLOCK: type | field: "value", ...]` in the record. This resource has no builder fields with declared block types — if you encounter blocks, ask the user to clarify rather than guessing block names from the rendered placeholders.',
        '',
      ]),
      'Be concise and helpful.',
    ].join('\n')
  }

  buildTools(): AnyTool[] {
    return this.state.tools
  }

  getConversationMeta(): ConversationStoreMeta {
    const meta: ConversationStoreMeta = {
      resourceSlug: this.state.resourceSlug,
      recordId:     this.state.recordId,
    }
    if (this.state.userId) meta.userId = this.state.userId
    return meta
  }

  shouldLoadHistory(): boolean {
    // Selection mode is a one-shot edit, not a multi-turn conversation
    return !this.state.selection
  }

  transformUserInput(input: string, history: AiMessage[]): string {
    const { record, selection } = this.state
    if (history.length > 0 && !selection && Object.keys(record).length > 0) {
      return `${input}\n\n[Current record state: ${JSON.stringify(record)}]`
    }
    return input
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
