'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { navigate } from 'vike/client/router'
import type { PanelNavigationMeta } from '@pilotiq/panels'
import { useI18n } from '../_hooks/useI18n.js'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog.js'

interface SearchResult {
  resource: string
  label:    string
  records:  Array<{ id: string; title: string }>
}

interface Props {
  panelMeta:    PanelNavigationMeta
  pathSegment:  string
}

export function GlobalSearch({ panelMeta, pathSegment }: Props) {
  const i18n = useI18n()
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Flatten results for keyboard nav
  const flatItems = results.flatMap((g) =>
    g.records.map((r) => ({ resource: g.resource, id: r.id, title: r.title, label: g.label }))
  )

  // Cmd/Ctrl+K shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Focus input when opening
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  function close() {
    setOpen(false)
    setQuery('')
    setResults([])
    setFocused(0)
  }

  function goToItem(item: { resource: string; id: string }) {
    close()
    void navigate(`/${pathSegment}/resources/${item.resource}/${item.id}`)
  }

  const search = useCallback((q: string) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    fetch(`/${pathSegment}/api/_search?q=${encodeURIComponent(q)}&limit=5`)
      .then((r) => r.ok ? r.json() as Promise<{ results: SearchResult[] }> : { results: [] })
      .then((data) => { setResults(data.results); setFocused(0) })
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [pathSegment])

  function handleInput(value: string) {
    setQuery(value)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(value), 300)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused((f) => Math.min(f + 1, flatItems.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setFocused((f) => Math.max(f - 1, 0)) }
    if (e.key === 'Enter' && flatItems[focused]) { e.preventDefault(); goToItem(flatItems[focused]) }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 h-8 px-3 rounded-md border text-sm text-muted-foreground hover:bg-accent transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <span className="hidden sm:inline">{i18n.globalSearch ?? 'Search...'}</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border px-1.5 text-[10px] text-muted-foreground">
          {i18n.globalSearchShortcut ?? '⌘K'}
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent className="p-0 gap-0 max-w-lg" aria-describedby={undefined}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="flex items-center gap-2 px-4 border-b">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={i18n.globalSearch ?? 'Search everything...'}
              className="flex-1 h-12 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading && (
              <svg className="animate-spin h-4 w-4 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            )}
          </div>
          {query.trim() && (
            <div className="max-h-[400px] overflow-y-auto py-1.5">
              {!loading && flatItems.length === 0 && (
                <p className="px-4 py-6 text-sm text-center text-muted-foreground">
                  {(i18n.globalSearchEmpty ?? 'No results for ":query"').replace(':query', query)}
                </p>
              )}
              {results.map((group) => (
                <div key={group.resource}>
                  <p className="px-3 pt-3 pb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group.label}</p>
                  {group.records.map((record) => {
                    const idx = flatItems.findIndex((f) => f.id === record.id && f.resource === group.resource)
                    return (
                      <button
                        key={record.id}
                        className={[
                          'w-full flex items-center gap-2 px-3 py-2 text-sm text-start transition-colors',
                          idx === focused ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                        ].join(' ')}
                        onMouseEnter={() => setFocused(idx)}
                        onMouseDown={(e) => { e.preventDefault(); goToItem({ resource: group.resource, id: record.id }) }}
                      >
                        <span className="truncate">{record.title}</span>
                        <span className="ms-auto text-xs text-muted-foreground shrink-0">{group.label}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
