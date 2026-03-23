'use client'

import { useState, useCallback, useRef } from 'react'
import { navigate } from 'vike/client/router'

interface SessionUser {
  id: string
  name: string
  email: string
}

interface UseMediaActionsOptions {
  apiBase:         string
  pageBase:        string
  currentFolderId: string | null
  scope:           'shared' | 'private'
  sessionUser:     SessionUser | null
}

export function useMediaActions({ apiBase, pageBase, currentFolderId, scope, sessionUser }: UseMediaActionsOptions) {
  const [uploading, setUploading] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // ── Navigation ─────────────────────────────────────────────

  const navigateToFolder = useCallback((folderId: string | null) => {
    const params = new URLSearchParams()
    if (folderId) params.set('folder', folderId)
    if (scope === 'private') params.set('scope', 'private')
    const qs = params.toString()
    navigate(`${pageBase}${qs ? `?${qs}` : ''}`)
  }, [pageBase, scope])

  const handleSearch = useCallback(() => {
    const q = searchRef.current?.value ?? ''
    const params = new URLSearchParams()
    if (currentFolderId) params.set('folder', currentFolderId)
    if (scope === 'private') params.set('scope', 'private')
    if (q) params.set('search', q)
    const qs = params.toString()
    navigate(`${pageBase}${qs ? `?${qs}` : ''}`)
  }, [pageBase, currentFolderId, scope])

  const toggleScope = useCallback(() => {
    const next = scope === 'shared' ? 'private' : 'shared'
    const params = new URLSearchParams()
    if (next === 'private') params.set('scope', 'private')
    const qs = params.toString()
    navigate(`${pageBase}${qs ? `?${qs}` : ''}`)
  }, [pageBase, scope])

  const refresh = useCallback(() => {
    navigate(window.location.href)
  }, [])

  // ── Item actions ───────────────────────────────────────────

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

  // ── Folder creation ────────────────────────────────────────

  const createFolder = useCallback(async (name: string) => {
    await fetch(`${apiBase}/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        parentId: currentFolderId,
        scope,
        userId: scope === 'private' ? sessionUser?.id : null,
      }),
    })
    refresh()
  }, [apiBase, currentFolderId, scope, sessionUser, refresh])

  // ── Upload ─────────────────────────────────────────────────

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setUploading(true)
    try {
      const formData = new FormData()
      for (const file of files) formData.append('files', file)
      if (currentFolderId) formData.append('parentId', currentFolderId)
      formData.append('scope', scope)
      if (scope === 'private' && sessionUser) formData.append('userId', sessionUser.id)

      await fetch(`${apiBase}/upload`, { method: 'POST', body: formData })
      refresh()
    } finally {
      setUploading(false)
    }
  }, [apiBase, currentFolderId, scope, sessionUser, refresh])

  return {
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
  }
}
