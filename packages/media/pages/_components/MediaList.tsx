'use client'

import { useState, useCallback } from 'react'
import { FileIcon } from './FileIcon.js'

interface Props {
  items: Array<Record<string, unknown>>
  onDoubleClick: (item: Record<string, unknown>) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  panelPath: string
}

export function MediaList({ items, onDoubleClick, onDelete, onRename, panelPath }: Props) {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="space-y-0.5">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <span className="flex-1">Name</span>
        <span className="hidden w-20 shrink-0 text-right sm:block">Size</span>
        <span className="hidden w-24 shrink-0 text-right md:block">Type</span>
        <span className="hidden w-32 shrink-0 text-right lg:block">Modified</span>
        <span className="w-8 shrink-0" />
      </div>

      {items.map((item) => {
        const id = item['id'] as string
        const name = item['name'] as string
        const type = item['type'] as string
        const mime = item['mime'] as string | null
        const size = item['size'] as number | null
        const updatedAt = item['updatedAt'] as string
        const isSelected = selected === id

        return (
          <div
            key={id}
            className={`group flex items-center gap-4 rounded-lg px-4 py-2.5 cursor-pointer transition-colors ${
              isSelected ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted/50'
            }`}
            onClick={() => setSelected(id)}
            onDoubleClick={() => onDoubleClick(item)}
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <FileIcon type={type} mime={mime} className="size-5 shrink-0" />
              <span className="truncate text-sm font-medium">{name}</span>
            </div>
            <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground sm:block">
              {size ? formatSize(size) : '—'}
            </span>
            <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground md:block">
              {mime ?? (type === 'folder' ? 'Folder' : '—')}
            </span>
            <span className="hidden w-32 shrink-0 text-right text-xs text-muted-foreground lg:block">
              {formatDate(updatedAt)}
            </span>
            <button
              className="w-8 shrink-0 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 text-xs transition-opacity"
              onClick={(e) => { e.stopPropagation(); onDelete(id) }}
              title="Delete"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(d: string): string {
  try { return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(d)) }
  catch { return d }
}
