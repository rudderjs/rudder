import { useEffect, useRef } from 'react'
import { icons } from 'lucide-react'
import type { ContentBlockDef } from '@boostkit/panels'

function toPascal(s: string): string {
  return s.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())
}

interface Props {
  defs:          ContentBlockDef[]
  query:         string
  selectedIndex: number
  onSelect:      (type: string) => void
  position:      { top: number; left: number }
}

export function SlashCommandMenu({ defs, query, selectedIndex, onSelect, position }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

  const filtered = defs.filter(d =>
    d.label.toLowerCase().includes(query.toLowerCase()) ||
    d.type.toLowerCase().includes(query.toLowerCase())
  )

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div
      ref={ref}
      className="fixed z-50 w-56 rounded-lg border bg-popover shadow-lg py-1 overflow-hidden"
      style={{ top: position.top, left: position.left }}
    >
      <div className="max-h-[240px] overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground px-3 py-2">No matching blocks</p>
        )}
        {filtered.map((def, i) => {
          const Icon = (icons as Record<string, React.ComponentType<{ className?: string }>>)[toPascal(def.icon)]
          return (
            <button
              key={def.type}
              ref={(el) => { if (el) itemRefs.current.set(i, el); else itemRefs.current.delete(i) }}
              type="button"
              onClick={() => onSelect(def.type)}
              className={[
                'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm transition-colors text-left',
                i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent',
              ].join(' ')}
            >
              {Icon ? <Icon className="size-4 text-muted-foreground" /> : <span className="size-4" />}
              <span>{def.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Get filtered defs count for a given query (used by parent for bounds checking) */
export function filteredCount(defs: ContentBlockDef[], query: string): number {
  return defs.filter(d =>
    d.label.toLowerCase().includes(query.toLowerCase()) ||
    d.type.toLowerCase().includes(query.toLowerCase())
  ).length
}

/** Get the type at a given index in the filtered list */
export function filteredTypeAt(defs: ContentBlockDef[], query: string, index: number): string | undefined {
  const filtered = defs.filter(d =>
    d.label.toLowerCase().includes(query.toLowerCase()) ||
    d.type.toLowerCase().includes(query.toLowerCase())
  )
  return filtered[index]?.type
}
