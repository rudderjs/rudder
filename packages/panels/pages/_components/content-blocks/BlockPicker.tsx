import { useState, useRef, useEffect } from 'react'
import { icons } from 'lucide-react'
import type { ContentBlockDef } from '@boostkit/panels'

interface Props {
  defs:      ContentBlockDef[]
  onSelect:  (type: string) => void
  trigger:   'empty' | 'between' | 'bottom'
  placeholder?: string
}

function toPascal(s: string): string {
  return s.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())
}

export function BlockPicker({ defs, onSelect, trigger, placeholder }: Props) {
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

  if (trigger === 'empty') {
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {placeholder || 'Click to add content...'}
        </button>
        {open && (
          <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-30">
            <BlockList defs={defs} onSelect={(t) => { onSelect(t); setOpen(false) }} />
          </div>
        )}
      </div>
    )
  }

  if (trigger === 'between') {
    return (
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="h-5 w-5 rounded-full border bg-background text-xs text-muted-foreground hover:text-foreground hover:border-foreground transition-colors flex items-center justify-center"
        >+</button>
        {open && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-30">
            <BlockList defs={defs} onSelect={(t) => { onSelect(t); setOpen(false) }} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-4 py-2 rounded-md border border-dashed border-input text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <span className="text-base leading-none">+</span>
        Add block
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-30">
          <BlockList defs={defs} onSelect={(t) => { onSelect(t); setOpen(false) }} />
        </div>
      )}
    </div>
  )
}

function BlockList({ defs, onSelect }: { defs: ContentBlockDef[]; onSelect: (type: string) => void }) {
  const groups = new Map<string, ContentBlockDef[]>()
  for (const d of defs) {
    const g = groups.get(d.group) ?? []
    g.push(d)
    groups.set(d.group, g)
  }

  return (
    <div className="w-56 rounded-lg border bg-popover shadow-lg py-1 overflow-hidden">
      {[...groups.entries()].map(([group, items]) => (
        <div key={group}>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-3 pt-2 pb-1">{group}</p>
          {items.map((def) => {
            const Icon = (icons as Record<string, React.ComponentType<{ className?: string }>>)[toPascal(def.icon)]
            return (
              <button
                key={def.type}
                type="button"
                onClick={() => onSelect(def.type)}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-accent transition-colors text-left"
              >
                {Icon ? <Icon className="size-4 text-muted-foreground" /> : <span className="size-4" />}
                <span>{def.label}</span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
