import { useEffect, useRef, useState } from 'react'
import { PanelLeftIcon, XIcon, PlusIcon, ArrowUpIcon, SparklesIcon, CheckIcon } from 'lucide-react'
import { useAiChat, type ChatMessage, type ChatMessagePart } from './AiChatContext.js'
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

// ─── Message part renderer ──────────────────────────────────

function MessagePartView({ part }: { part: ChatMessagePart }) {
  switch (part.type) {
    case 'text':
      return (
        <div className="text-sm text-foreground whitespace-pre-wrap break-words">
          {part.text}
        </div>
      )

    case 'tool_call':
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-0.5">
          <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />
          <span>
            Updated <span className="font-medium text-foreground">{part.input?.field as string ?? part.tool.replace('update_', '')}</span>
          </span>
        </div>
      )

    case 'agent_start':
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
          <SparklesIcon className="h-3 w-3 shrink-0" />
          <span className="font-medium">Running: {part.agentLabel}</span>
        </div>
      )

    case 'complete':
      if (part.steps === 0 && part.tokens === 0) return null
      return (
        <div className="text-xs text-muted-foreground pt-1 border-t mt-1">
          Done — {part.steps} step{part.steps !== 1 ? 's' : ''}{part.tokens > 0 ? `, ${part.tokens} tokens` : ''}
        </div>
      )

    case 'error':
      return (
        <div className="text-xs text-red-600 dark:text-red-400">
          Error: {part.message}
        </div>
      )
  }
}

// ─── Message bubble ─────────────────────────────────────────

function MessageBubble({ message, isLast, isGenerating }: { message: ChatMessage; isLast: boolean; isGenerating: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
          {message.text}
        </div>
      </div>
    )
  }

  // Assistant message
  const parts = message.parts ?? []
  const hasContent = parts.length > 0 && (parts.length > 1 || (parts[0]?.type === 'text' && parts[0].text !== ''))
  const isStreaming = isLast && isGenerating

  return (
    <div className="flex gap-2">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <SparklesIcon className="h-3 w-3 text-primary" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {hasContent ? (
          parts.map((part, i) => <MessagePartView key={i} part={part} />)
        ) : isStreaming ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            Thinking...
          </span>
        ) : (
          // Fallback: plain text
          message.text ? (
            <div className="text-sm text-foreground whitespace-pre-wrap break-words">{message.text}</div>
          ) : null
        )}
        {/* Show streaming indicator after parts if still generating */}
        {isStreaming && hasContent && (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
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

// ─── Inner content (shared between desktop & mobile) ────────

function AiChatContent() {
  const { setOpen, messages, sendMessage, isGenerating, clearMessages } = useAiChat()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, messages[messages.length - 1]?.text, messages[messages.length - 1]?.parts?.length])

  const hasContent = messages.length > 0

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

      {/* Messages area */}
      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3">
          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isLast={i === messages.length - 1}
              isGenerating={isGenerating}
            />
          ))}
        </div>
      )}

      {/* Chat input */}
      <ChatInput onSend={(text) => sendMessage(text)} disabled={isGenerating} />
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
