interface Props {
  hasAgents: boolean
  open:      boolean
  onToggle:  () => void
}

export function AgentToolbar({ hasAgents, open, onToggle }: Props) {
  if (!hasAgents) return null

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 text-sm transition-colors ${
        open
          ? 'text-primary'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      </svg>
      AI Agents
    </button>
  )
}
