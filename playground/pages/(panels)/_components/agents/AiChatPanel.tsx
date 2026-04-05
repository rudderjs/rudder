import { useEffect, useRef, useState } from 'react'
import { PanelLeftIcon, XIcon, PlusIcon, ArrowUpIcon, SparklesIcon, CheckIcon, ChevronDownIcon, TrashIcon, MessageSquareIcon } from 'lucide-react'
import { useAiChat, type ChatMessage, type ChatMessagePart, type ConversationItem } from './AiChatContext.js'
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

// ─── Model selector ─────────────────────────────────────────

function ModelSelector() {
  const { models, selectedModel, setSelectedModel } = useAiChat()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (models.length === 0) return null

  const current = models.find(m => m.id === selectedModel) ?? models[0]

  return (
    <div ref={ref} className="relative">
      <button
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="truncate max-w-[120px]">{current?.label ?? 'Default'}</span>
        <ChevronDownIcon className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[160px] rounded-md border bg-popover shadow-md z-30">
          {models.map(m => (
            <button
              key={m.id}
              className={`flex w-full items-center px-3 py-1.5 text-xs hover:bg-muted/50 ${
                (selectedModel ?? models[0]?.id) === m.id ? 'text-primary font-medium' : ''
              }`}
              onClick={() => { setSelectedModel(m.id); setOpen(false) }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
      <div className="flex items-center justify-between px-2 pb-2">
        <ModelSelector />
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

// ─── Relative time helper ──────────────────────────────────

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = Date.now()
  const diff = now - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

// ─── Conversation switcher dropdown ─────────────────────────

function ConversationSwitcher() {
  const {
    conversationId, conversations,
    showConversations, setShowConversations,
    loadConversation, loadConversations, deleteConversation,
    newConversation,
  } = useAiChat()
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load conversations when dropdown opens
  useEffect(() => {
    if (showConversations) loadConversations()
  }, [showConversations, loadConversations])

  // Close on click outside
  useEffect(() => {
    if (!showConversations) return
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowConversations(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showConversations, setShowConversations])

  const activeTitle = conversations.find(c => c.id === conversationId)?.title

  return (
    <div ref={dropdownRef} className="relative border-b">
      {/* Trigger bar */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
        onClick={() => setShowConversations(!showConversations)}
      >
        <MessageSquareIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 truncate text-left font-medium">
          {activeTitle ?? 'New conversation'}
        </span>
        <ChevronDownIcon className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showConversations ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {showConversations && (
        <div className="absolute left-0 right-0 top-full z-20 max-h-64 overflow-y-auto border-b bg-sidebar shadow-md">
          {/* New chat */}
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 border-b"
            onClick={() => { newConversation(); setShowConversations(false) }}
          >
            <PlusIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">New chat</span>
          </button>

          {conversations.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No conversations yet
            </div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                className={`group flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer ${
                  conv.id === conversationId ? 'bg-muted' : ''
                }`}
                onClick={() => { loadConversation(conv.id); setShowConversations(false) }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{conv.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {relativeTime(conv.updatedAt ?? conv.createdAt)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id) }}
                >
                  <TrashIcon className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Resource context pill ──────────────────────────────────

function ResourceContextPill() {
  const { resourceContext } = useAiChat()
  if (!resourceContext) return null

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b text-xs text-muted-foreground">
      <span className="truncate">
        <span className="font-medium text-foreground">{resourceContext.resourceSlug}</span>
        {' › '}
        <span>{resourceContext.recordId}</span>
      </span>
    </div>
  )
}

// ─── Inner content (shared between desktop & mobile) ────────

function AiChatContent() {
  const { setOpen, messages, sendMessage, isGenerating, newConversation } = useAiChat()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll on new messages
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, messages[messages.length - 1]?.text, messages[messages.length - 1]?.parts?.length])

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 items-center gap-2 border-b px-3 shrink-0">
        <h3 className="flex-1 text-sm font-semibold truncate">AI Assistant</h3>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={newConversation}
          aria-label="New chat"
          title="New chat"
        >
          <PlusIcon className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <XIcon className="h-4 w-4" />
        </Button>
      </div>

      {/* Conversation switcher dropdown */}
      <ConversationSwitcher />

      {/* Resource context pill */}
      <ResourceContextPill />

      {/* Messages */}
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
