import { useEffect } from 'react'
import { PanelLeftIcon, XIcon } from 'lucide-react'
import { AgentOutput, useAgentRun } from './AgentOutput.js'
import { useAiChat } from './AiChatContext.js'
import { useIsMobile } from '@/hooks/use-mobile.js'
import { Button } from '@/components/ui/button.js'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.js'

// ─── Sidebar width (matches shadcn sidebar) ─────────────────

const AI_SIDEBAR_WIDTH = '20rem'

// ─── Inner content (shared between desktop & mobile) ────────

function AiChatContent() {
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
    const t = setTimeout(() => {
      run(currentRun.agentSlug, currentRun.recordId, currentRun.input)
    }, 50)
    return () => clearTimeout(t)
  }, [runKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const isRunning = status === 'running'

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b px-4 shrink-0">
        <h3 className="text-sm font-semibold">AI Assistant</h3>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(false)}
          aria-label="Close AI sidebar"
        >
          <XIcon />
        </Button>
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

// ─── AI Sidebar ─────────────────────────────────────────────

export function AiChatPanel() {
  const { open, setOpen } = useAiChat()
  const isMobile = useIsMobile()

  // Mobile → Sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-[--ai-sidebar-width] p-0 [&>button]:hidden"
          style={{ '--ai-sidebar-width': AI_SIDEBAR_WIDTH } as React.CSSProperties}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>AI Assistant</SheetTitle>
            <SheetDescription>AI chat sidebar.</SheetDescription>
          </SheetHeader>
          <AiChatContent />
        </SheetContent>
      </Sheet>
    )
  }

  // Desktop → sidebar with slide transition
  return (
    <div
      data-slot="ai-sidebar"
      className="hidden text-sidebar-foreground md:block"
      style={{ '--ai-sidebar-width': AI_SIDEBAR_WIDTH } as React.CSSProperties}
    >
      {/* Gap — pushes content left when open */}
      <div
        className="relative bg-transparent transition-[width] duration-200 ease-linear"
        style={{ width: open ? 'var(--ai-sidebar-width)' : '0px' }}
      />
      {/* Fixed panel */}
      <div
        className="fixed inset-y-0 z-10 hidden h-svh border-l bg-sidebar transition-[right] duration-200 ease-linear md:flex"
        style={{
          width: 'var(--ai-sidebar-width)',
          right: open ? '0px' : 'calc(var(--ai-sidebar-width) * -1)',
        }}
      >
        <div className="flex size-full flex-col">
          <AiChatContent />
        </div>
      </div>
    </div>
  )
}

// ─── AI Sidebar Trigger ─────────────────────────────────────

export function AiChatTrigger() {
  let ctx: ReturnType<typeof useAiChat> | null = null
  try { ctx = useAiChat() } catch { /* AiChatProvider not mounted */ }
  if (!ctx) return null

  const { open, setOpen } = ctx
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setOpen(!open)}
      aria-label="Toggle AI sidebar"
      className={open ? 'text-primary' : ''}
    >
      <PanelLeftIcon className="rotate-180" />
      <span className="sr-only">Toggle AI Sidebar</span>
    </Button>
  )
}
