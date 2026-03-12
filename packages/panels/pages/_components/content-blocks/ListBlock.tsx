interface Props {
  style: 'bullet' | 'numbered'
  items: string[]
  onChange: (patch: Record<string, unknown>) => void
  disabled?: boolean
}

export function ListBlock({ style, items, onChange, disabled }: Props) {
  function updateItem(index: number, text: string) {
    onChange({ items: items.map((t, i) => i === index ? text : t) })
  }
  function addItem() {
    onChange({ items: [...items, ''] })
  }
  function removeItem(index: number) {
    if (items.length <= 1) return
    onChange({ items: items.filter((_, i) => i !== index) })
  }
  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addItem() }
    if (e.key === 'Backspace' && items[index] === '' && items.length > 1) {
      e.preventDefault(); removeItem(index)
    }
  }

  const Tag = style === 'numbered' ? 'ol' : 'ul'

  return (
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={() => onChange({ style: style === 'bullet' ? 'numbered' : 'bullet' })}
        className="text-xs text-muted-foreground hover:text-foreground mt-1.5 shrink-0"
        disabled={disabled}
      >
        {style === 'bullet' ? '•' : '1.'}
      </button>
      <Tag className={`flex-1 flex flex-col gap-1 ${style === 'numbered' ? 'list-decimal' : 'list-disc'} pl-5`}>
        {items.map((item, i) => (
          <li key={i}>
            <input
              type="text"
              value={item}
              onChange={(e) => updateItem(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="w-full bg-transparent outline-none text-sm py-0.5"
              placeholder="List item..."
              disabled={disabled}
            />
          </li>
        ))}
      </Tag>
    </div>
  )
}
