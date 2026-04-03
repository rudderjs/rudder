import { useEffect, useRef, useState } from 'react'
import { PanelLeftIcon, XIcon, PlusIcon, ArrowUpIcon, SparklesIcon } from 'lucide-react'
import { AgentOutput, useAgentRun } from './AgentOutput.js'
import { useAiChat, type ChatMessage } from './AiChatContext.js'
import { useIsMobile } from '@/hooks/use-mobile.js'
import { Button } from '@/components/ui/button.js'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet.js'

// ─── Sidebar width ──────────────────────────────────────────

const AI_SIDEBAR_WIDTH = '22rem'

// ─── Chat input ─────────────────────────────────────────────

function ChatInput({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSubmit() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    // Reset height
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleInput() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  return (
    <div className="border rounded-lg bg-background mx-3 mb-3">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => { setValue(e.target.value); handleInput() }}
        onKeyDown={handleKeyDown}
        placeholder="Ask AI..."
        rows={1}
        className="w-full resize-none bg-transparent px-3 pt-3 pb-1 text-sm outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-end px-2 pb-2">
        <Button
          variant="default"
          size="icon-sm"
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className="h-6 w-6 rounded-full"
        >
          <ArrowUpIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ─── Message bubble ─────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <SparklesIcon className="h-3 w-3 text-primary" />
      </div>
      <div className="min-w-0 text-sm text-foreground whitespace-pre-wrap break-words">
        {message.text || (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Thinking...
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Empty state ────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
        <SparklesIcon className="h-5 w-5 text-primary" />
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Ask about your data, or run an<br />AI agent from a resource form.
      </p>
    </div>
  )
}

// ─── Agent run banner ───────────────────────────────────────

function AgentRunSection() {
  const { currentRun, runKey, onFieldUpdate } = useAiChat()
  const { entries, status, run, reset } = useAgentRun(
    currentRun?.apiBase ?? '',
    currentRun?.resourceSlug ?? '',
    onFieldUpdate,
  )

  useEffect(() => {
    if (!currentRun || runKey === 0) return
    reset()
    const t = setTimeout(() => {
      run(currentRun.agentSlug, currentRun.recordId, currentRun.input)
    }, 50)
    return () => clearTimeout(t)
  }, [runKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentRun) return null

  const isRunning = status === 'running'

  return (
    <div className="border-b">
      {/* Agent context bar */}
      <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/30 flex items-center gap-2">
        {isRunning && <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse shrink-0" />}
        <SparklesIcon className="h-3 w-3 shrink-0" />
        <span className="truncate font-medium">{currentRun.agentLabel}</span>
      </div>
      {/* Output */}
      {entries.length > 0 && (
        <div className="px-4 py-3">
          <AgentOutput entries={entries} status={status} />
        </div>
      )}
      {(status === 'complete' || status === 'error') && (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={() => reset()}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Inner content (shared between desktop & mobile) ────────

function AiChatContent() {
  const { setOpen, messages, sendMessage, isGenerating, clearMessages, currentRun } = useAiChat()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, messages[messages.length - 1]?.text])

  const hasContent = messages.length > 0 || currentRun

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 items-center gap-2 border-b px-3 shrink-0">
        <h3 className="flex-1 text-sm font-semibold">AI Assistant</h3>
        {hasContent && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={clearMessages}
            aria-label="New chat"
            title="New chat"
          >
            <PlusIcon className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <XIcon className="h-4 w-4" />
        </Button>
      </div>

      {/* Agent run section (if active) */}
      <AgentRunSection />

      {/* Messages area */}
      {messages.length === 0 && !currentRun ? (
        <EmptyState />
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      )}

      {/* Chat input */}
      <ChatInput onSend={sendMessage} disabled={isGenerating} />
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
