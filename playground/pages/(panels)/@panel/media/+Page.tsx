'use client'

import { useState, useCallback } from 'react'
import { useData } from 'vike-react/useData'
import type { Data } from './+data.js'
import type { MediaRecord } from '@pilotiq/media'
import { useMediaActions } from './_lib/useMediaActions.js'
import { MediaGrid } from './_components/MediaGrid.js'
import { MediaList } from './_components/MediaList.js'
import { MediaPreview } from './_components/MediaPreview.js'
import { MediaUploadZone } from './_components/MediaUploadZone.js'
import { NewFolderDialog } from './_components/NewFolderDialog.js'

export default function MediaPage() {
  const { items, breadcrumbs, scope, search, pathSegment, currentFolder, sessionUser } = useData<Data>()
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [previewItem, setPreviewItem] = useState<MediaRecord | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)

  const apiBase = `/${pathSegment}/api/media`
  const pageBase = `/${pathSegment}/media`
  const currentFolderId = currentFolder?.id ?? null

  const {
    uploading,
    searchRef,
    navigateToFolder,
    handleSearch,
    toggleScope,
    deleteItem,
    renameItem,
    updateItem,
    moveToFolder,
    createFolder,
    uploadFiles,
  } = useMediaActions({ apiBase, pageBase, currentFolderId, scope, sessionUser })

  // ── Item interactions ────────────────────────────────────────

  const handleDoubleClick = useCallback((item: MediaRecord) => {
    if (item.type === 'folder') {
      navigateToFolder(item.id)
    } else {
      setPreviewItem(item)
    }
  }, [navigateToFolder])

  const handleCreateFolder = useCallback(async (name: string) => {
    await createFolder(name)
    setShowNewFolder(false)
  }, [createFolder])

  // ── Drag and drop from OS / browser ──────────────────────────

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Dragged URL (image from another browser tab)
    const uri = e.dataTransfer.getData('text/uri-list')
    if (uri && !e.dataTransfer.files.length) {
      try {
        const response = await fetch(uri)
        const blob = await response.blob()
        const filename = uri.split('/').pop()?.split('?')[0] || 'downloaded-image'
        const file = new File([blob], filename, { type: blob.type })
        await uploadFiles([file])
      } catch { /* ignore failed URL fetches */ }
      return
    }

    // Directory drops via webkitGetAsEntry
    const entries = Array.from(e.dataTransfer.items)
      .map(item => item.webkitGetAsEntry?.())
      .filter(Boolean) as FileSystemEntry[]

    if (entries.some(entry => entry.isDirectory)) {
      const allFiles = await readEntries(entries)
      await uploadFiles(allFiles)
      return
    }

    // Regular file drops
    const files = Array.from(e.dataTransfer.files)
    if (files.length) await uploadFiles(files)
  }, [uploadFiles])

  // ── Render ─────────────────────────────────────────────────

  const files = items.filter((i): i is MediaRecord => i.type !== 'folder')

  return (
    <div className="flex h-full flex-col"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
      onDrop={handleDrop}
    >
      {/* Header */}
      <header className="flex items-center gap-4 border-b px-5 py-3">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 text-sm flex-1 min-w-0">
          <button
            onClick={() => navigateToFolder(null)}
            className="rounded px-2 py-1 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            Media
          </button>
          {breadcrumbs.map((crumb, i) => (
            <div key={crumb.id} className="flex items-center gap-1 min-w-0">
              <span className="text-muted-foreground shrink-0">/</span>
              <button
                onClick={() => navigateToFolder(crumb.id)}
                className={`rounded px-2 py-1 truncate transition-colors ${
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

        {/* Search */}
        <div className="relative w-56 shrink-0">
          <input
            ref={searchRef}
            type="search"
            placeholder="Search files..."
            defaultValue={search}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full h-8 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setView('grid')}
            className={`p-1.5 rounded transition-colors ${view === 'grid' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
            title="Grid view"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM9 2.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zM9 10.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z"/></svg>
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-1.5 rounded transition-colors ${view === 'list' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
            title="List view"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/></svg>
          </button>
        </div>

        {/* Scope toggle */}
        <button
          onClick={toggleScope}
          className="text-xs px-3 py-1.5 rounded-md border bg-background hover:bg-muted transition-colors shrink-0"
        >
          {scope === 'shared' ? 'All Files' : 'My Files'}
        </button>

        {/* Actions */}
        <button
          onClick={() => setShowNewFolder(true)}
          className="text-xs px-3 py-1.5 rounded-md border bg-background hover:bg-muted transition-colors shrink-0"
        >
          + Folder
        </button>
        <label className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground cursor-pointer hover:bg-primary/90 transition-colors shrink-0">
          Upload
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => uploadFiles(Array.from(e.target.files ?? []))}
          />
        </label>
      </header>

      {/* Upload zone overlay */}
      <MediaUploadZone uploading={uploading} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {items.length === 0 && !search ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <svg className="w-16 h-16 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
            <p className="text-lg font-medium">No files yet</p>
            <p className="text-sm mt-1">Drop files here or click Upload</p>
          </div>
        ) : items.length === 0 && search ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p className="text-lg font-medium">No results for "{search}"</p>
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
          onConfirm={handleCreateFolder}
          onCancel={() => setShowNewFolder(false)}
        />
      )}
    </div>
  )
}

// ── Directory entry reader ───────────────────────────────────

async function readEntries(entries: FileSystemEntry[]): Promise<File[]> {
  const files: File[] = []
  for (const entry of entries) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve),
      )
      files.push(file)
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      const children = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve),
      )
      files.push(...await readEntries(children))
    }
  }
  return files
}
