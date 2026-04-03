import { useEffect } from 'react'
import { AgentOutput, useAgentRun } from './AgentOutput.js'
import { useAiChat } from './AiChatContext.js'

export function AiChatPanel() {
  const { open, setOpen, currentRun, runKey, onFieldUpdate } = useAiChat()
  const { entries, status, run, reset } = useAgentRun(
    currentRun?.apiBase ?? '',
    currentRun?.resourceSlug ?? '',
    onFieldUpdate,
  )

  // Auto-run when a new agent run is triggered
  useEffect(() => {
    if (!currentRun || runKey === 0) return
    reset()
    // Small delay to let reset clear state before starting new run
    const t = setTimeout(() => {
      run(currentRun.agentSlug, currentRun.recordId, currentRun.input)
    }, 50)
    return () => clearTimeout(t)
  }, [runKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  const isRunning = status === 'running'

  return (
    <div className="w-80 border-l bg-background flex flex-col shrink-0 h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <h3 className="text-sm font-semibold">AI Chat</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
          aria-label="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Current agent context */}
      {currentRun && (
        <div className="px-4 py-2 border-b text-xs text-muted-foreground bg-muted/30 shrink-0 flex items-center gap-2">
          {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />}
          <span className="truncate">{currentRun.agentLabel}</span>
        </div>
      )}

      {/* Output — scrollable */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        {entries.length === 0 && status === 'idle' ? (
          <p className="text-sm text-muted-foreground leading-relaxed">
            Run an AI agent from a resource form to see output here.
          </p>
        ) : (
          <AgentOutput entries={entries} status={status} />
        )}
      </div>

      {/* Footer — clear button */}
      {(status === 'complete' || status === 'error') && (
        <div className="px-4 py-2.5 border-t shrink-0">
          <button
            type="button"
            onClick={() => reset()}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear output
          </button>
        </div>
      )}
    </div>
  )
}
