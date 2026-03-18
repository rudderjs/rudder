'use client'

import { useState, useCallback } from 'react'
import { FileIcon } from './FileIcon.js'

interface Props {
  items: Array<Record<string, unknown>>
  onDoubleClick: (item: Record<string, unknown>) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onMove: (itemId: string, targetFolderId: string) => void
  panelPath: string
}

export function MediaGrid({ items, onDoubleClick, onDelete, onRename, onMove, panelPath }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
    setSelected(id)
  }, [])

  const handleRenameSubmit = useCallback((id: string, value: string) => {
    const trimmed = value.trim()
    if (trimmed) onRename(id, trimmed)
    setRenaming(null)
  }, [onRename])

  // Drag-to-folder support
  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOverFolder = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(folderId)
  }, [])

  const handleDropOnFolder = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    const itemId = e.dataTransfer.getData('text/plain')
    if (itemId && itemId !== folderId) {
      onMove(itemId, folderId)
    }
    setDragOver(null)
  }, [onMove])

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item) => {
          const id = item['id'] as string
          const name = item['name'] as string
          const type = item['type'] as string
          const mime = item['mime'] as string | null
          const isFolder = type === 'folder'
          const isImage = mime?.startsWith('image/') ?? false
          const isSelected = selected === id

          return (
            <div
              key={id}
              className={`group relative flex flex-col items-center gap-3 rounded-xl p-4 cursor-pointer transition-all ${
                isSelected
                  ? 'bg-primary/10 ring-2 ring-primary'
                  : dragOver === id
                  ? 'bg-primary/20 ring-2 ring-primary ring-dashed'
                  : 'bg-card hover:bg-muted/50'
              }`}
              onClick={() => setSelected(id)}
              onDoubleClick={() => onDoubleClick(item)}
              onContextMenu={(e) => handleContextMenu(e, id)}
              draggable={!isFolder}
              onDragStart={!isFolder ? (e) => handleDragStart(e, id) : undefined}
              onDragOver={isFolder ? (e) => handleDragOverFolder(e, id) : undefined}
              onDragLeave={isFolder ? () => setDragOver(null) : undefined}
              onDrop={isFolder ? (e) => handleDropOnFolder(e, id) : undefined}
            >
              {/* Thumbnail / Icon */}
              <div className="flex size-16 items-center justify-center rounded-xl bg-muted/50 overflow-hidden">
                {isImage && item['directory'] && item['filename'] ? (
                  <img
                    src={`/storage/${item['directory']}/${item['filename']}`}
                    alt={name}
                    className="size-16 object-cover rounded-xl"
                    loading="lazy"
                  />
                ) : (
                  <FileIcon type={type} mime={mime} className="size-8" />
                )}
              </div>

              {/* Name */}
              {renaming === id ? (
                <input
                  autoFocus
                  defaultValue={name}
                  className="w-full text-center text-sm bg-background border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                  onBlur={(e) => handleRenameSubmit(id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit(id, (e.target as HTMLInputElement).value)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <p className="w-full text-center text-sm font-medium truncate">{name}</p>
              )}

              {/* Size */}
              {!isFolder && item['size'] && (
                <p className="text-xs text-muted-foreground">
                  {formatSize(item['size'] as number)}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 rounded-lg border bg-popover py-1 shadow-lg text-sm min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-muted transition-colors"
              onClick={() => { onDoubleClick(items.find(i => i['id'] === contextMenu.id)!); setContextMenu(null) }}
            >
              Open
            </button>
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-muted transition-colors"
              onClick={() => { setRenaming(contextMenu.id); setContextMenu(null) }}
            >
              Rename
            </button>
            <div className="my-1 border-t" />
            <button
              className="w-full px-3 py-1.5 text-left text-destructive hover:bg-muted transition-colors"
              onClick={() => { onDelete(contextMenu.id); setContextMenu(null) }}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
