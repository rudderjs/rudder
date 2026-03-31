interface StreamingMessageProps {
  text: string
}

/** Animated streaming text with blinking cursor */
export function StreamingMessage({ text }: StreamingMessageProps) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'flex-start',
      marginBottom: 12,
    }}>
      <div style={{
        maxWidth: '75%',
        padding: '10px 14px',
        borderRadius: '16px 16px 16px 4px',
        background: '#f1f5f9',
        color: '#1e293b',
        fontSize: 14,
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {text}
        <span style={{
          display: 'inline-block',
          width: 6,
          height: 16,
          background: '#6366f1',
          marginLeft: 2,
          verticalAlign: 'text-bottom',
          animation: 'blink 1s step-end infinite',
        }} />
        <style>{`@keyframes blink { 50% { opacity: 0 } }`}</style>
      </div>
    </div>
  )
}
