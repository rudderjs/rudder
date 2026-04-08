import { useState } from 'react'
import type { PanelAgentMeta } from '@rudderjs/panels'
import { AgentOutput, useAgentRun, type AgentStatus, type OnFieldUpdate } from './AgentOutput.js'

interface Props {
  agents:       PanelAgentMeta[]
  recordId:     string
  resourceSlug: string
  apiBase:      string
  open:         boolean
  onClose:      () => void
  onFieldUpdate?: OnFieldUpdate
}

export function AgentSidebar({ agents, recordId, resourceSlug, apiBase, open, onClose, onFieldUpdate }: Props) {
  const { entries, status, run, reset } = useAgentRun(apiBase, resourceSlug, onFieldUpdate)
  const [activeAgent, setActiveAgent] = useState<string | null>(null)
  const [input, setInput] = useState('')

  if (!open) return null

  function handleRun(slug: string) {
    setActiveAgent(slug)
    run(slug, recordId, input || undefined)
    setInput('')
  }

  function handleReset() {
    reset()
    setActiveAgent(null)
  }

  const isRunning = status === 'running'

  return (
    <div className="w-80 border-l bg-background flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold">AI Agents</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Agent buttons */}
      <div className="px-4 py-3 space-y-1.5 border-b">
        {agents.map(agent => (
          <button
            key={agent.slug}
            type="button"
            disabled={isRunning}
            onClick={() => handleRun(agent.slug)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left ${
              activeAgent === agent.slug && isRunning
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-muted text-foreground disabled:opacity-50'
            }`}
          >
            {agent.icon && <AgentIcon name={agent.icon} />}
            <span className="truncate">{agent.label}</span>
            {activeAgent === agent.slug && isRunning && (
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <AgentOutput entries={entries} status={status} />
      </div>

      {/* Input / actions */}
      <div className="px-4 py-3 border-t space-y-2">
        {(status === 'complete' || status === 'error') && (
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear output
          </button>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && activeAgent && !isRunning) {
                handleRun(activeAgent)
              }
            }}
            placeholder="Optional instructions..."
            disabled={isRunning}
            className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Simple icon fallback (Lucide names) ────────────────────

function AgentIcon({ name }: { name: string }) {
  // Common agent icons as inline SVGs
  const icons: Record<string, React.ReactNode> = {
    Search: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" />
      </svg>
    ),
    Languages: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />
      </svg>
    ),
    Sparkles: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      </svg>
    ),
  }

  return (
    <span className="text-muted-foreground shrink-0">
      {icons[name] ?? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
      )}
    </span>
  )
}
