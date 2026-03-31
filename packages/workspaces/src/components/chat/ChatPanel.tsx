import { useState, useCallback, useRef, useEffect } from 'react'
import { ChatMessage } from './ChatMessage.js'
import { StreamingMessage } from './StreamingMessage.js'
import { ChatInput } from './ChatInput.js'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface ChatPanelProps {
  /** Workspace ID */
  workspaceId: string
  /** Panel API base path */
  apiBase?: string
  /** Fixed height (null = fill available space) */
  height?: number | null
  /** Persist conversation in localStorage */
  persist?: boolean
  /** Current user name */
  userName?: string
}

/**
 * Chat panel UI — message list + input + streaming responses.
 *
 * Sends messages to the workspace chat endpoint (SSE streaming).
 * Shows streaming text as it arrives, then finalizes into a message bubble.
 */
export function ChatPanel({
  workspaceId,
  apiBase = '/api/panel',
  height = null,
  persist = false,
  userName,
}: ChatPanelProps) {
  const storageKey = `workspace:${workspaceId}:chat`

  const [messages, setMessages] = useState<Message[]>(() => {
    if (!persist || typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem(storageKey)
      return stored ? JSON.parse(stored) : []
    } catch { return [] }
  })

  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streamingText])

  // Persist messages
  useEffect(() => {
    if (!persist || typeof window === 'undefined') return
    try { localStorage.setItem(storageKey, JSON.stringify(messages)) } catch { /* ignore */ }
  }, [persist, storageKey, messages])

  const handleSend = useCallback(async (input: string) => {
    // Add user message
    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    }
    setMessages(prev => [...prev, userMsg])
    setIsStreaming(true)
    setStreamingText('')

    try {
      // Send to chat endpoint (SSE)
      const response = await fetch(`${apiBase}/workspaces/${workspaceId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          conversationId,
        }),
      })

      if (!response.ok) {
        throw new Error(`Chat request failed: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let newConvId = conversationId

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value, { stream: true })
          // Parse SSE lines
          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const event = JSON.parse(data)
              if (event.type === 'text-delta' && event.text) {
                accumulated += event.text
                setStreamingText(accumulated)
              } else if (event.type === 'conversation-id') {
                newConvId = event.conversationId
                setConversationId(newConvId)
              }
            } catch { /* skip malformed lines */ }
          }
        }
      }

      // Finalize: add assistant message
      if (accumulated) {
        const assistantMsg: Message = {
          id: `msg_${Date.now()}`,
          role: 'assistant',
          content: accumulated,
          timestamp: Date.now(),
        }
        setMessages(prev => [...prev, assistantMsg])
      }
    } catch (err) {
      // Add error message
      const errorMsg: Message = {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
        timestamp: Date.now(),
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsStreaming(false)
      setStreamingText('')
    }
  }, [apiBase, workspaceId, conversationId])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: height ?? '100%',
      minHeight: 300,
      border: '1px solid #e2e8f0',
      borderRadius: 12,
      overflow: 'hidden',
      background: 'white',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid #e2e8f0',
        fontWeight: 600,
        fontSize: 14,
        color: '#1e293b',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>💬</span>
        Workspace Chat
        {isStreaming && (
          <span style={{ fontSize: 11, color: '#6366f1', fontWeight: 400 }}>
            Thinking...
          </span>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 16,
        }}
      >
        {messages.length === 0 && !isStreaming && (
          <div style={{
            textAlign: 'center',
            color: '#94a3b8',
            fontSize: 14,
            padding: '40px 0',
          }}>
            Send a message to start a conversation with the workspace.
          </div>
        )}

        {messages.map(msg => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            userName={msg.role === 'assistant' ? 'Orchestrator' : userName}
            timestamp={msg.timestamp}
          />
        ))}

        {isStreaming && streamingText && (
          <StreamingMessage text={streamingText} />
        )}
      </div>

      {/* Input */}
      <ChatInput
        onSend={handleSend}
        disabled={isStreaming}
      />
    </div>
  )
}
