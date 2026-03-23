'use client'

import { useState, useCallback } from 'react'
import type { MediaRecord } from '../_lib/types.js'
import { formatSize } from '../_lib/format.js'
import { FileIcon } from './FileIcon.js'
import { ContextMenu } from './ContextMenu.js'

interface Props {
  items: MediaRecord[]
  onDoubleClick: (item: MediaRecord) => void
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
    if (itemId && itemId !== folderId) onMove(itemId, folderId)
    setDragOver(null)
  }, [onMove])

  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item) => {
          const isFolder = item.type === 'folder'
          const isImage = item.mime?.startsWith('image/') ?? false
          const isSelected = selected === item.id

          return (
            <div
              key={item.id}
              className={`group relative flex flex-col items-center gap-3 rounded-xl p-4 cursor-pointer transition-all ${
                isSelected
                  ? 'bg-primary/10 ring-2 ring-primary'
                  : dragOver === item.id
                  ? 'bg-primary/20 ring-2 ring-primary ring-dashed'
                  : 'bg-card hover:bg-muted/50'
              }`}
              onClick={() => setSelected(item.id)}
              onDoubleClick={() => onDoubleClick(item)}
              onContextMenu={(e) => handleContextMenu(e, item.id)}
              draggable={!isFolder}
              onDragStart={!isFolder ? (e) => handleDragStart(e, item.id) : undefined}
              onDragOver={isFolder ? (e) => handleDragOverFolder(e, item.id) : undefined}
              onDragLeave={isFolder ? () => setDragOver(null) : undefined}
              onDrop={isFolder ? (e) => handleDropOnFolder(e, item.id) : undefined}
            >
              {/* Thumbnail / Icon */}
              <div className="flex size-16 items-center justify-center rounded-xl bg-muted/50 overflow-hidden">
                {isImage && item.directory && item.filename ? (
                  <img
                    src={`/storage/${item.directory}/${item.filename}`}
                    alt={item.name}
                    className="size-16 object-cover rounded-xl"
                    loading="lazy"
                  />
                ) : (
                  <FileIcon type={item.type} mime={item.mime} className="size-8" />
                )}
              </div>

              {/* Name */}
              {renaming === item.id ? (
                <input
                  autoFocus
                  defaultValue={item.name}
                  className="w-full text-center text-sm bg-background border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
                  onBlur={(e) => handleRenameSubmit(item.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit(item.id, (e.target as HTMLInputElement).value)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                />
              ) : (
                <p className="w-full text-center text-sm font-medium truncate">{item.name}</p>
              )}

              {/* Size */}
              {!isFolder && item.size && (
                <p className="text-xs text-muted-foreground">
                  {formatSize(item.size)}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onOpen={() => { onDoubleClick(items.find(i => i.id === contextMenu.id)!); setContextMenu(null) }}
          onRename={() => { setRenaming(contextMenu.id); setContextMenu(null) }}
          onDelete={() => { onDelete(contextMenu.id); setContextMenu(null) }}
        />
      )}
    </>
  )
}
