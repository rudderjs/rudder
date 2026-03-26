'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { MediaRecord, ConversionInfo } from '../types.js'
import { categorize } from '../types.js'

// ─── Persist helpers (inline — same logic as panels _lib/persist.ts) ──

type PersistMode = false | 'localStorage' | 'url' | 'session'

function readPersisted(mode: PersistMode, key: string): Record<string, string> {
  if (typeof window === 'undefined' || !mode) return {}
  if (mode === 'localStorage') {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : {} } catch { return {} }
  }
  if (mode === 'url') {
    const url = new URL(window.location.href)
    const state: Record<string, string> = {}
    for (const [k, v] of url.searchParams.entries()) {
      if (k.startsWith(`${key}_`)) state[k.slice(key.length + 1)] = v
    }
    return state
  }
  return {}
}

function savePersisted(mode: PersistMode, key: string, state: Record<string, string>): void {
  if (!mode || typeof window === 'undefined') return
  if (mode === 'localStorage') {
    localStorage.setItem(key, JSON.stringify(state))
    return
  }
  if (mode === 'url') {
    const url = new URL(window.location.href)
    for (const k of [...url.searchParams.keys()]) {
      if (k.startsWith(`${key}_`)) url.searchParams.delete(k)
    }
    for (const [k, v] of Object.entries(state)) {
      if (v) url.searchParams.set(`${key}_${k}`, v)
    }
    window.history.replaceState(null, '', url.pathname + url.search)
  }
}

// ─── Types ───────────────────────────────────────────────────

interface MediaLibraryMeta {
  name:           string
  disk:           string
  directory:      string
  accept?:        string[]
  maxUploadSize?: number
  conversions?:   Array<{ name: string; width: number; height?: number; crop?: boolean; format?: string; quality?: number }>
}

interface MediaElementMeta {
  type:           'media'
  id:             string
  title:          string
  libraries:      MediaLibraryMeta[]
  activeLibrary:  string
  scope:          'shared' | 'private'
  searchable?:    boolean
  perPage?:       number
  persist?:       false | 'localStorage' | 'url' | 'session'
  sortBy?:        string
  sortDir?:       'asc' | 'desc'
  totalPages?:    number
  currentPage?:   number
  totalItems?:    number
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

// ─── Main component ──────────────────────────────────────────

export function MediaElement({ element, panelPath }: Props) {
  const persistMode = element.persist ?? false
  const persistKey = `media:${element.id}`
  const initial = useRef(readPersisted(persistMode, persistKey)).current

  const [view, setView] = useState<'grid' | 'list'>((initial['view'] as 'grid' | 'list') || 'grid')
  const [items, setItems] = useState<MediaRecord[]>(element.items)
  const [breadcrumbs, setBreadcrumbs] = useState(element.breadcrumbs)
  const [currentFolder, setCurrentFolder] = useState(element.currentFolder)
  const [previewItem, setPreviewItem] = useState<MediaRecord | null>(null)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [activeLib, setActiveLib] = useState(initial['library'] || element.activeLibrary)
  const [search, setSearch] = useState(initial['search'] || '')
  const [sortBy, setSortBy] = useState(initial['sort'] || element.sortBy || 'name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>((initial['dir'] as 'asc' | 'desc') || element.sortDir || 'asc')
  const [page, setPage] = useState(element.currentPage ?? 1)
  const [totalPages, setTotalPages] = useState(element.totalPages ?? 0)
  const [totalItems, setTotalItems] = useState(element.totalItems ?? 0)

  const pathSegment = panelPath.replace(/^\//, '')
  const lib = element.libraries.find(l => l.name === activeLib) ?? element.libraries[0]!
  const apiBase = `/${pathSegment}/api/media`
  const currentFolderId = currentFolder?.id ?? null

  // ── API helpers ────────────────────────────────────────────

  const fetchItems = useCallback(async (parentId: string | null, opts?: { directory?: string | undefined; search?: string | undefined; page?: number | undefined; sort?: string | undefined; dir?: string | undefined }) => {
    const params = new URLSearchParams()
    if (parentId) params.set('parentId', parentId)
    params.set('scope', element.scope)
    const dir = opts?.directory ?? lib.directory
    if (dir) params.set('directory', dir)
    const q = opts?.search ?? search
    if (q) params.set('search', q)
    params.set('sort', opts?.sort ?? sortBy)
    params.set('dir', opts?.dir ?? sortDir)
    if (element.perPage) {
      params.set('perPage', String(element.perPage))
      params.set('page', String(opts?.page ?? page))
    }
    const res = await fetch(`${apiBase}?${params}`)
    const data = await res.json() as { items: MediaRecord[]; breadcrumbs: Array<{ id: string; name: string }>; totalPages?: number; totalItems?: number; page?: number }
    setItems(data.items)
    setBreadcrumbs(data.breadcrumbs)
    if (data.totalPages !== undefined) setTotalPages(data.totalPages)
    if (data.totalItems !== undefined) setTotalItems(data.totalItems)
    if (data.page !== undefined) setPage(data.page)
  }, [apiBase, element.scope, element.perPage, lib.directory, search, page, sortBy, sortDir])

  // Fetch on mount — skip if SSR already loaded items
  useEffect(() => {
    if (element.items.length === 0) fetchItems(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist state on change
  useEffect(() => {
    savePersisted(persistMode, persistKey, {
      view,
      library: activeLib,
      search,
      sort: sortBy,
      dir: sortDir,
      page: String(page),
    })
  }, [view, activeLib, search, sortBy, sortDir, page, persistMode, persistKey])

  const navigateToFolder = useCallback(async (folderId: string | null) => {
    if (folderId) {
      const folder = items.find(i => i.id === folderId) ?? null
      setCurrentFolder(folder)
    } else {
      setCurrentFolder(null)
    }
    setSelected(null)
    setPage(1)
    await fetchItems(folderId, { page: 1 })
  }, [fetchItems, items])

  const refresh = useCallback(() => fetchItems(currentFolderId), [fetchItems, currentFolderId])

  const handleDoubleClick = useCallback((item: MediaRecord) => {
    if (item.type === 'folder') navigateToFolder(item.id)
    else setPreviewItem(item)
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
    setRenaming(null)
    refresh()
  }, [apiBase, refresh])

  const createFolder = useCallback(async () => {
    const trimmed = folderName.trim()
    if (!trimmed) return
    await fetch(`${apiBase}/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed, parentId: currentFolderId, scope: element.scope, disk: lib.disk, directory: lib.directory }),
    })
    setShowNewFolder(false)
    setFolderName('')
    refresh()
  }, [apiBase, currentFolderId, element.scope, folderName, refresh])

  const uploadFiles = useCallback(async (fileList: File[]) => {
    if (fileList.length === 0) return
    setUploading(true)
    try {
      const fd = new FormData()
      for (const file of fileList) fd.append('files', file)
      if (currentFolderId) fd.append('parentId', currentFolderId)
      fd.append('scope', element.scope)
      fd.append('disk', lib.disk)
      fd.append('directory', lib.directory)
      if (lib.maxUploadSize) fd.append('maxUploadSize', String(lib.maxUploadSize))
      if (lib.conversions?.length) fd.append('conversions', JSON.stringify(lib.conversions))
      await fetch(`${apiBase}/upload`, { method: 'POST', body: fd })
      refresh()
    } finally {
      setUploading(false)
    }
  }, [apiBase, currentFolderId, element.scope, lib, refresh])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const files = Array.from(e.dataTransfer.files)
    if (files.length) await uploadFiles(files)
  }, [uploadFiles])

  // ── Render ─────────────────────────────────────────────────

  return (
    <div
      className="rounded-xl border bg-card overflow-hidden flex flex-col"
      style={element.height ? { height: element.height } : undefined}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <nav className="flex items-center gap-1 text-sm flex-1 min-w-0">
          <button
            onClick={() => navigateToFolder(null)}
            className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            {element.title}
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1 min-w-0">
              <span className="text-muted-foreground shrink-0">/</span>
              <button
                onClick={() => navigateToFolder(crumb.id)}
                className={`rounded px-1.5 py-0.5 truncate transition-colors text-sm ${
                  i === breadcrumbs.length - 1 ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        {/* Search */}
        {element.searchable && (
          <div className="relative w-44 shrink-0">
            <input
              type="search"
              placeholder="Search..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
                fetchItems(currentFolderId, { search: e.target.value, page: 1 })
              }}
              className="w-full h-7 rounded-md border bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        )}

        {/* Library selector — only shown when multiple libraries */}
        {element.libraries.length > 1 && (
          <select
            value={activeLib}
            onChange={(e) => {
              const name = e.target.value
              setActiveLib(name)
              setCurrentFolder(null)
              setSelected(null)
              setPage(1)
              const newLib = element.libraries.find(l => l.name === name)
              fetchItems(null, { directory: newLib?.directory, page: 1 })
            }}
            className="text-xs rounded-md border bg-background px-2 py-1 shrink-0"
          >
            {element.libraries.map(l => (
              <option key={l.name} value={l.name}>{l.name.charAt(0).toUpperCase() + l.name.slice(1)}</option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setView('grid')}
            className={`p-1 rounded transition-colors ${view === 'grid' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <GridIcon />
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-1 rounded transition-colors ${view === 'list' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <ListIcon />
          </button>
        </div>

        {/* Sort */}
        <select
          value={`${sortBy}:${sortDir}`}
          onChange={(e) => {
            const [s, d] = e.target.value.split(':') as [string, 'asc' | 'desc']
            setSortBy(s)
            setSortDir(d)
            setPage(1)
            fetchItems(currentFolderId, { sort: s, dir: d, page: 1 })
          }}
          className="text-xs rounded-md border bg-background px-2 py-1 shrink-0"
        >
          <option value="name:asc">Name A-Z</option>
          <option value="name:desc">Name Z-A</option>
          <option value="createdAt:desc">Newest</option>
          <option value="createdAt:asc">Oldest</option>
          <option value="size:desc">Largest</option>
          <option value="size:asc">Smallest</option>
        </select>

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
            accept={lib.accept?.length ? lib.accept.join(',') : undefined}
            className="hidden"
            onChange={(e) => uploadFiles(Array.from(e.target.files ?? []))}
          />
        </label>
      </div>

      {/* Upload indicator */}
      {uploading && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-primary/5 border-b text-xs">
          <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-muted-foreground">Uploading...</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <p className="text-sm">No files yet</p>
            <p className="text-xs mt-1">Drop files here or click Upload</p>
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((item) => (
              <GridItem
                key={item.id}
                item={item}
                isSelected={selected === item.id}
                isRenaming={renaming === item.id}
                onSelect={() => setSelected(item.id)}
                onDoubleClick={() => handleDoubleClick(item)}
                onRename={(name) => renameItem(item.id, name)}
                onCancelRename={() => setRenaming(null)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {items.map((item) => (
              <ListItem
                key={item.id}
                item={item}
                isSelected={selected === item.id}
                onSelect={() => setSelected(item.id)}
                onDoubleClick={() => handleDoubleClick(item)}
                onDelete={() => deleteItem(item.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Preview overlay */}
      {previewItem && (
        <PreviewOverlay
          item={previewItem}
          onClose={() => setPreviewItem(null)}
          onDelete={() => { deleteItem(previewItem.id); setPreviewItem(null) }}
        />
      )}

      {/* Pagination */}
      {element.perPage && totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs shrink-0">
          <span className="text-muted-foreground">{totalItems} items</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => { setPage(page - 1); fetchItems(currentFolderId, { page: page - 1 }) }}
              className="px-2 py-1 rounded border hover:bg-muted disabled:opacity-30 transition-colors"
            >
              ←
            </button>
            <span className="px-2 text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => { setPage(page + 1); fetchItems(currentFolderId, { page: page + 1 }) }}
              className="px-2 py-1 rounded border hover:bg-muted disabled:opacity-30 transition-colors"
            >
              →
            </button>
          </div>
        </div>
      )}

      {/* New folder dialog */}
      {showNewFolder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowNewFolder(false)} />
          <div className="relative bg-background rounded-xl border shadow-xl p-6 w-96">
            <h3 className="text-sm font-semibold mb-4">New Folder</h3>
            <input
              autoFocus
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') setShowNewFolder(false) }}
              placeholder="Folder name"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowNewFolder(false)} className="px-3 py-1.5 rounded-md border text-sm hover:bg-muted transition-colors">Cancel</button>
              <button onClick={createFolder} disabled={!folderName.trim()} className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Grid item ───────────────────────────────────────────────

function GridItem({ item, isSelected, isRenaming, onSelect, onDoubleClick, onRename, onCancelRename }: {
  item: MediaRecord
  isSelected: boolean
  isRenaming: boolean
  onSelect: () => void
  onDoubleClick: () => void
  onRename: (name: string) => void
  onCancelRename: () => void
}) {
  const isFolder = item.type === 'folder'
  const isImage = item.mime?.startsWith('image/') ?? false

  return (
    <div
      className={`group relative flex flex-col items-center gap-2 rounded-xl p-3 cursor-pointer transition-all ${
        isSelected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted/50'
      }`}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      <div className="flex size-14 items-center justify-center rounded-lg bg-muted/50 overflow-hidden">
        {isImage && item.directory && item.filename ? (
          <img src={`/storage/${item.directory}/${item.filename}`} alt={item.name} className="size-14 object-cover rounded-lg" loading="lazy" />
        ) : (
          <FileTypeIcon type={item.type} mime={item.mime} />
        )}
      </div>
      {isRenaming ? (
        <input
          autoFocus
          defaultValue={item.name}
          className="w-full text-center text-xs bg-background border rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
          onBlur={(e) => onRename(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onRename((e.target as HTMLInputElement).value); if (e.key === 'Escape') onCancelRename() }}
        />
      ) : (
        <p className="w-full text-center text-xs font-medium truncate">{item.name}</p>
      )}
      {!isFolder && item.size && <p className="text-[10px] text-muted-foreground">{formatSize(item.size)}</p>}
    </div>
  )
}

// ─── List item ───────────────────────────────────────────────

function ListItem({ item, isSelected, onSelect, onDoubleClick, onDelete }: {
  item: MediaRecord
  isSelected: boolean
  onSelect: () => void
  onDoubleClick: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={`group flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
        isSelected ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted/50'
      }`}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      <FileTypeIcon type={item.type} mime={item.mime} />
      <span className="flex-1 truncate text-sm">{item.name}</span>
      <span className="text-xs text-muted-foreground w-16 text-right">{item.size ? formatSize(item.size) : '—'}</span>
      <button
        className="w-6 opacity-0 group-hover:opacity-100 text-destructive text-xs transition-opacity"
        onClick={(e) => { e.stopPropagation(); onDelete() }}
      >
        ✕
      </button>
    </div>
  )
}

// ─── Preview overlay ─────────────────────────────────────────

function PreviewOverlay({ item, onClose, onDelete }: {
  item: MediaRecord
  onClose: () => void
  onDelete: () => void
}) {
  const fileUrl = `/storage/${item.directory}/${item.filename}`
  const isImage = item.mime?.startsWith('image/') ?? false
  const isVideo = item.mime?.startsWith('video/') ?? false
  const isAudio = item.mime?.startsWith('audio/') ?? false

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-sm font-semibold truncate">{item.name}</h3>
          <div className="flex items-center gap-2">
            <a href={fileUrl} download={item.name} className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors">Download</a>
            <button onClick={onDelete} className="text-xs px-2 py-1 rounded text-destructive border hover:bg-muted transition-colors">Delete</button>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 overflow-auto bg-muted/30">
          {isImage ? <img src={fileUrl} alt={item.name} className="max-w-full max-h-[60vh] object-contain rounded-lg" />
           : isVideo ? <video src={fileUrl} controls className="max-w-full max-h-[60vh] rounded-lg" />
           : isAudio ? <audio src={fileUrl} controls className="w-80" />
           : <div className="text-center text-muted-foreground"><p className="text-sm">{item.name}</p><p className="text-xs mt-1">Preview not available</p></div>}
        </div>
        <div className="flex items-center gap-4 px-5 py-2.5 border-t text-xs text-muted-foreground">
          {item.mime && <span>{item.mime}</span>}
          {item.size && <span>{formatSize(item.size)}</span>}
          {item.width && item.height && <span>{item.width} × {item.height}</span>}
        </div>
      </div>
    </div>
  )
}

// ─── File type icon ──────────────────────────────────────────

function FileTypeIcon({ type, mime }: { type: string; mime: string | null }) {
  if (type === 'folder') return <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>

  const cat = categorize(mime)
  const colors: Record<string, string> = { image: 'text-green-500', video: 'text-pink-500', audio: 'text-yellow-500', pdf: 'text-red-500', document: 'text-blue-500', spreadsheet: 'text-emerald-500', text: 'text-orange-400', archive: 'text-purple-400' }
  const color = colors[cat] ?? 'text-muted-foreground'

  return <svg className={`w-6 h-6 ${color}`} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>
}

// ─── Icons ───────────────────────────────────────────────────

function GridIcon() {
  return <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16"><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM9 2.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zM9 10.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z"/></svg>
}

function ListIcon() {
  return <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/></svg>
}

// ─── Helpers ─────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
