import { useState } from 'react'
import type { PanelI18n, PanelAgentMeta } from '@rudderjs/panels'
import { useAiChat, type AgentRunRequest } from '../agents/AiChatContext.js'

interface Props {
  draftable:     boolean
  recordStatus:  string | null
  saving:        boolean
  backHref:      string
  onPublish:     () => void
  onUnpublish:   () => void
  i18n:          PanelI18n & Record<string, string>
  agents?:       PanelAgentMeta[] | undefined
  resourceSlug?: string | undefined
  recordId?:     string | undefined
  apiBase?:      string | undefined
}

export function FormActions({ draftable, recordStatus, saving, backHref, onPublish, onUnpublish, i18n, agents, resourceSlug, recordId, apiBase }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  let aiChat: ReturnType<typeof useAiChat> | null = null
  try { aiChat = useAiChat() } catch { /* no provider */ }

  const hasAgents = !!agents?.length && !!resourceSlug && !!recordId && !!apiBase

  function handleAgentClick(agent: PanelAgentMeta) {
    setDropdownOpen(false)
    aiChat?.triggerRun({
      agentSlug:    agent.slug,
      agentLabel:   agent.label,
      resourceSlug: resourceSlug!,
      recordId:     recordId!,
      apiBase:      apiBase!,
    })
  }

  return (
    <div className="flex items-center gap-3 pt-2">
      {draftable ? (
        <>
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2 border border-border text-sm font-medium rounded-md hover:bg-accent transition-colors disabled:opacity-50"
          >
            {saving ? (i18n.savingDraft ?? 'Saving\u2026') : (i18n.saveDraft ?? 'Save Draft')}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onPublish}
            className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? (i18n.publishingButton ?? 'Publishing\u2026') : (i18n.publishButton ?? 'Publish')}
          </button>
          {recordStatus === 'published' && (
            <button
              type="button"
              disabled={saving}
              onClick={onUnpublish}
              className="px-5 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              {i18n.unpublish ?? 'Unpublish'}
            </button>
          )}
        </>
      ) : (
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? i18n.saving : i18n.save}
        </button>
      )}
      <a
        href={backHref}
        className="px-5 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {i18n.cancel}
      </a>

      {/* AI Agents dropdown */}
      {hasAgents && (
        <div className="relative ms-auto">
          <button
            type="button"
            onClick={() => setDropdownOpen(v => !v)}
            onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
            </svg>
            AI Agents
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
            </svg>
          </button>
          {dropdownOpen && (
            <div className="absolute bottom-full mb-1 right-0 w-52 border rounded-md bg-popover shadow-md py-1 z-50">
              {agents!.map(agent => (
                <button
                  key={agent.slug}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); handleAgentClick(agent) }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                >
                  <AgentIcon name={agent.icon} />
                  {agent.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentIcon({ name }: { name?: string | undefined }) {
  if (!name) return null
  const icons: Record<string, React.ReactNode> = {
    Search: (
      <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" />
      </svg>
    ),
    Sparkles: (
      <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      </svg>
    ),
  }
  return <>{icons[name] ?? null}</>
}
