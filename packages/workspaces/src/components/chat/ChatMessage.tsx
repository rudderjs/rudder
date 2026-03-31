interface ChatMessageProps {
  role: 'user' | 'assistant'
  content: string
  userName?: string | undefined
  timestamp?: number | undefined
}

/** Single message bubble */
export function ChatMessage({ role, content, userName, timestamp }: ChatMessageProps) {
  const isUser = role === 'user'

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 12,
    }}>
      <div style={{
        maxWidth: '75%',
        padding: '10px 14px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: isUser ? '#6366f1' : '#f1f5f9',
        color: isUser ? 'white' : '#1e293b',
        fontSize: 14,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {!isUser && userName && (
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6366f1', marginBottom: 4 }}>
            {userName}
          </div>
        )}
        {content}
        {timestamp && (
          <div style={{
            fontSize: 10,
            opacity: 0.6,
            marginTop: 4,
            textAlign: 'right',
          }}>
            {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  )
}
