'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { navigate } from 'vike/client/router'
import type { PanelMeta } from '@boostkit/panels'

interface SearchResult {
  resource: string
  label:    string
  records:  Array<{ id: string; title: string }>
}

interface Props {
  panelMeta:   PanelMeta
  pathSegment: string
}

function t(template: string, vars: Record<string, string>): string {
  return template.replace(/:([a-z]+)/g, (_, k: string) => vars[k] ?? `:${k}`)
}

export function GlobalSearch({ panelMeta, pathSegment }: Props) {
  const { i18n } = panelMeta
  const [open,    setOpen]    = useState(false)
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(-1)

  const inputRef     = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ⌘K / Ctrl+K opens search
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(true)
        setTimeout(() => inputRef.current?.focus(), 0)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
        setResults([])
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  // Fetch results with debounce
  const fetchResults = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setResults([]); setLoading(false); return }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res  = await fetch(`/${pathSegment}/api/_search?q=${encodeURIComponent(q)}&limit=5`)
        const data = await res.json() as { results: SearchResult[] }
        setResults(data.results)
        setFocused(-1)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [pathSegment])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    fetchResults(val)
  }

  // Flat list of all {resource, id} pairs for keyboard nav
  const flatItems = results.flatMap(group =>
    group.records.map(r => ({ resource: group.resource, id: r.id }))
  )

  function goToItem(index: number) {
    const item = flatItems[index]
    if (!item) return
    void navigate(`/${pathSegment}/${item.resource}/${item.id}`)
    setOpen(false)
    setQuery('')
    setResults([])
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      setQuery('')
      setResults([])
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocused(i => Math.min(i + 1, flatItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocused(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && focused >= 0) {
      e.preventDefault()
      goToItem(focused)
    }
  }

  const hasResults = results.some(g => g.records.length > 0)
  const showEmpty  = !loading && query.trim().length > 0 && !hasResults

  // Track flat index as we render
  let flatIndex = 0

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button (closed state) */}
      {!open && (
        <button
          type="button"
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }}
          className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <SearchIcon />
          <span className="hidden sm:inline">{i18n.globalSearch}</span>
          <span className="hidden sm:inline text-xs border border-input rounded px-1 py-0.5 font-mono leading-none">
            {i18n.globalSearchShortcut}
          </span>
        </button>
      )}

      {/* Search input (open state) */}
      {open && (
        <div className="flex flex-col">
          <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-ring bg-background ring-2 ring-ring min-w-[260px]">
            <SearchIcon className="text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder={i18n.globalSearch}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {loading && <SpinnerIcon />}
          </div>

          {/* Dropdown */}
          {(hasResults || showEmpty) && (
            <div className="absolute top-full mt-1 start-0 end-0 z-50 min-w-[320px] rounded-lg border border-border bg-popover shadow-lg py-1.5 max-h-[400px] overflow-y-auto">

              {showEmpty && (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  {t(i18n.globalSearchEmpty, { query: query.trim() })}
                </p>
              )}

              {results.map((group) => {
                if (group.records.length === 0) return null
                return (
                  <div key={group.resource}>
                    <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {group.label}
                    </p>
                    {group.records.map((record) => {
                      const idx = flatIndex++
                      const isFocused = idx === focused
                      return (
                        <button
                          key={record.id}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); goToItem(idx) }}
                          onMouseEnter={() => setFocused(idx)}
                          className={[
                            'w-full flex items-center gap-2 px-3 py-2 text-sm text-start transition-colors',
                            isFocused
                              ? 'bg-accent text-accent-foreground'
                              : 'hover:bg-accent hover:text-accent-foreground',
                          ].join(' ')}
                        >
                          <span className="truncate">{record.title}</span>
                          <span className="ms-auto text-xs text-muted-foreground shrink-0">
                            {group.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}

            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14" fill="none"
      className={className}
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M9.5 9.5L12.5 12.5" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14" fill="none"
      className="animate-spin text-muted-foreground"
      stroke="currentColor" strokeWidth="1.5"
    >
      <circle cx="7" cy="7" r="5.5" strokeDasharray="20 15" strokeLinecap="round" />
    </svg>
  )
}
