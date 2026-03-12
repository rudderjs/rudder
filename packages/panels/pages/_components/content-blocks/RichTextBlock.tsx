import { useRef, useCallback, useEffect } from 'react'

interface Props {
  text:      string
  onChange:  (text: string) => void
  tag?:      'p' | 'h1' | 'h2' | 'h3'
  disabled?: boolean
  placeholder?: string
}

const tagStyles: Record<string, string> = {
  p:  'text-base',
  h1: 'text-3xl font-bold',
  h2: 'text-2xl font-semibold',
  h3: 'text-xl font-semibold',
}

export function RichTextBlock({ text, onChange, tag = 'p', disabled, placeholder }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const lastHtml = useRef(text)

  // Set initial content on mount
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = text
      lastHtml.current = text
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync external changes (collaborative updates) — skip if we're the source
  useEffect(() => {
    if (ref.current && text !== lastHtml.current) {
      const sel = window.getSelection()
      const hadFocus = document.activeElement === ref.current

      ref.current.innerHTML = text
      lastHtml.current = text

      if (hadFocus && sel && ref.current.childNodes.length > 0) {
        const range = document.createRange()
        range.selectNodeContents(ref.current)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }
    }
  }, [text])

  const handleInput = useCallback(() => {
    if (!ref.current) return
    const html = sanitizeHtml(ref.current.innerHTML)
    if (html !== lastHtml.current) {
      lastHtml.current = html
      onChange(html)
    }
  }, [onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled) return
    const mod = e.metaKey || e.ctrlKey

    if (mod && e.key === 'b') {
      e.preventDefault()
      document.execCommand('bold')
    } else if (mod && e.key === 'i') {
      e.preventDefault()
      document.execCommand('italic')
    } else if (mod && e.key === 'u') {
      e.preventDefault()
      document.execCommand('underline')
    } else if (mod && e.key === 'k') {
      e.preventDefault()
      const url = prompt('Link URL:')
      if (url) document.execCommand('createLink', false, url)
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      document.execCommand('insertLineBreak')
    }
  }, [disabled])

  return (
    <div className="relative">
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder ?? ''}
        className={[
          tagStyles[tag] ?? tagStyles.p,
          'outline-none min-h-[1.5em] px-1 py-0.5 rounded',
          'focus:bg-accent/30 transition-colors',
          'empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50',
          disabled ? 'cursor-default' : '',
          '[&_a]:text-primary [&_a]:underline',
        ].join(' ')}
      />
    </div>
  )
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<(?!\/?(?:b|i|u|s|a|br)\b)[^>]*>/gi, '')
    .replace(/<(b|i|u|s|br)(\s[^>]*)?>/gi, '<$1>')
    .replace(/<a\s+(?:(?!href)[^>])*?(href="[^"]*")[^>]*>/gi, '<a $1>')
    .replace(/<(\w+)>\s*<\/\1>/g, '')
    .replace(/&nbsp;/g, ' ')
}
