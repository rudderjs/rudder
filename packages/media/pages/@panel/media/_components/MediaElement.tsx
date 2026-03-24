'use client'

import { useState, useCallback } from 'react'
import type { MediaRecord } from '@boostkit/media'
import { MediaGrid } from './MediaGrid.js'
import { MediaList } from './MediaList.js'
import { MediaPreview } from './MediaPreview.js'
import { MediaUploadZone } from './MediaUploadZone.js'
import { NewFolderDialog } from './NewFolderDialog.js'

interface MediaElementMeta {
  type:           'media'
  id:             string
  title:          string
  disk:           string
  directory:      string
  accept:         string[]
  maxUploadSize:  number
  scope:          'shared' | 'private'
  height?:        number
  items:          MediaRecord[]
  breadcrumbs:    Array<{ id: string; name: string }>
  currentFolder:  MediaRecord | null
  lazy?:          boolean
  pollInterval?:  number
}

interface Props {
  element:   MediaElementMeta
  panelPath: string
  i18n:      Record<string, unknown>
}

export function MediaElement({ element, panelPath }: Props) {
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [items, setItems] = useState<MediaRecord[]>(element.items)
  const [breadcrumbs, setBreadcrumbs] = useState(element.breadcrumbs)
  const [currentFolder, setCurrentFolder] = useState(element.currentFolder)
  const [previewItem, setPreviewItem] = useState<MediaRecord | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [uploading, setUploading] = useState(false)

  const pathSegment = panelPath.replace(/^\//, '')
  const apiBase = `/${pathSegment}/api/media`
  const currentFolderId = currentFolder?.id ?? null

  // ── Fetch items from API ──────────────────────────────────

  const fetchItems = useCallback(async (parentId: string | null) => {
    const params = new URLSearchParams()
    if (parentId) params.set('parentId', parentId)
    params.set('scope', element.scope)
    const qs = params.toString()
    const res = await fetch(`${apiBase}${qs ? `?${qs}` : ''}`)
    const data = await res.json() as { items: MediaRecord[]; breadcrumbs: Array<{ id: string; name: string }> }
    setItems(data.items)
    setBreadcrumbs(data.breadcrumbs)
  }, [apiBase, element.scope])

  const navigateToFolder = useCallback(async (folderId: string | null) => {
    const folder = folderId ? items.find(i => i.id === folderId) ?? null : null
    setCurrentFolder(folder as MediaRecord | null)
    await fetchItems(folderId)
  }, [fetchItems, items])

  const refresh = useCallback(() => {
    fetchItems(currentFolderId)
  }, [fetchItems, currentFolderId])

  // ── Item actions ───────────────────────────────────────────

  const handleDoubleClick = useCallback((item: MediaRecord) => {
    if (item.type === 'folder') {
      navigateToFolder(item.id)
    } else {
      setPreviewItem(item)
    }
  }, [navigateToFolder])

  const deleteItem = useCallback(async (id: string) => {
    await fetch(`${apiBase}/${id}`, { method: 'DELETE' })
    refresh()
  }, [apiBase, refresh])

  const renameItem = useCallback(async (id: string, newName: string) => {
    await fetch(`${apiBase}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    })
    refresh()
  }, [apiBase, refresh])

  const updateItem = useCallback(async (id: string, data: Record<string, unknown>) => {
    await fetch(`${apiBase}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    refresh()
  }, [apiBase, refresh])

  const moveToFolder = useCallback(async (itemId: string, targetFolderId: string) => {
    await fetch(`${apiBase}/${itemId}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: targetFolderId }),
    })
    refresh()
  }, [apiBase, refresh])

  const createFolder = useCallback(async (name: string) => {
    await fetch(`${apiBase}/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId: currentFolderId, scope: element.scope }),
    })
    setShowNewFolder(false)
    refresh()
  }, [apiBase, currentFolderId, element.scope, refresh])

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    try {
      const formData = new FormData()
      for (const file of files) formData.append('files', file)
      if (currentFolderId) formData.append('parentId', currentFolderId)
      formData.append('scope', element.scope)
      await fetch(`${apiBase}/upload`, { method: 'POST', body: formData })
      refresh()
    } finally {
      setUploading(false)
    }
  }, [apiBase, currentFolderId, element.scope, refresh])

  // ── Drop handler ───────────────────────────────────────────

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    if (files.length) await uploadFiles(files)
  }, [uploadFiles])

  // ── Render ─────────────────────────────────────────────────

  const files = items.filter((i): i is MediaRecord => i.type !== 'folder')

  return (
    <div
      className="rounded-xl border bg-card overflow-hidden flex flex-col"
      style={element.height ? { height: element.height } : undefined}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
      onDrop={handleDrop}
    >
      {/* Header */}
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 text-sm flex-1 min-w-0">
          <button
            onClick={() => navigateToFolder(null)}
            className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0 text-sm"
          >
            {element.title}
          </button>
          {breadcrumbs.map((crumb, i) => (
            <div key={crumb.id} className="flex items-center gap-1 min-w-0">
              <span className="text-muted-foreground shrink-0">/</span>
              <button
                onClick={() => navigateToFolder(crumb.id)}
                className={`rounded px-1.5 py-0.5 truncate transition-colors text-sm ${
                  i === breadcrumbs.length - 1
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </nav>

        {/* View toggle */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setView('grid')}
            className={`p-1 rounded transition-colors ${view === 'grid' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16"><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM9 2.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zM9 10.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z"/></svg>
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-1 rounded transition-colors ${view === 'list' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/></svg>
          </button>
        </div>

        {/* Actions */}
        <button
          onClick={() => setShowNewFolder(true)}
          className="text-xs px-2.5 py-1 rounded-md border bg-background hover:bg-muted transition-colors shrink-0"
        >
          + Folder
        </button>
        <label className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90 transition-colors shrink-0">
          Upload
          <input
            type="file"
            multiple
            accept={element.accept.length ? element.accept.join(',') : undefined}
            className="hidden"
            onChange={(e) => uploadFiles(Array.from(e.target.files ?? []))}
          />
        </label>
      </header>

      {/* Upload indicator */}
      <MediaUploadZone uploading={uploading} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <p className="text-sm">No files yet</p>
            <p className="text-xs mt-1">Drop files here or click Upload</p>
          </div>
        ) : view === 'grid' ? (
          <MediaGrid
            items={items}
            onDoubleClick={handleDoubleClick}
            onDelete={deleteItem}
            onRename={renameItem}
            onMove={moveToFolder}
            panelPath={pathSegment}
          />
        ) : (
          <MediaList
            items={items}
            onDoubleClick={handleDoubleClick}
            onDelete={deleteItem}
            onRename={renameItem}
            panelPath={pathSegment}
          />
        )}
      </div>

      {/* Preview panel */}
      {previewItem && (
        <MediaPreview
          item={previewItem}
          items={files}
          onClose={() => setPreviewItem(null)}
          onNavigate={setPreviewItem}
          panelPath={pathSegment}
          onDelete={deleteItem}
          onUpdate={updateItem}
        />
      )}

      {/* New folder dialog */}
      {showNewFolder && (
        <NewFolderDialog
          onConfirm={createFolder}
          onCancel={() => setShowNewFolder(false)}
        />
      )}
    </div>
  )
}
