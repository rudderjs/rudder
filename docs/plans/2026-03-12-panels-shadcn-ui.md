# Panels shadcn/ui Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hand-rolled panels UI components with shadcn/ui components (Sidebar, DropdownMenu, AlertDialog, Table, Breadcrumb, Tooltip, Tabs, Badge, Switch, Separator, Avatar, Sheet) and add dark/light mode toggle.

**Architecture:** Install shadcn components into the playground (`src/components/ui/`), then rewrite panels page components to import from `@/components/ui/*` instead of using raw HTML and `@base-ui-components/react`. The panels source pages (`packages/panels/pages/`) are the canonical source — after editing them, run `pnpm artisan vendor:publish --tag=panels-pages --force` from the playground to sync. Dark mode uses a `ThemeProvider` wrapping the layout with class-based toggling (`.dark` on `<html>`), persisted to `localStorage`.

**Tech Stack:** shadcn/ui v4 (base-nova style), Tailwind CSS v4, lucide-react, class-variance-authority

---

### Task 1: Install shadcn components

**Files:**
- Modify: `playground/src/components/ui/` (new files auto-created by shadcn CLI)
- Modify: `playground/package.json` (deps updated automatically)

**Step 1: Install all needed shadcn components**

```bash
cd /Users/sleman/Projects/boostkit/.claude/worktrees/panels-shadcn-ui/playground
npx shadcn@latest add sidebar dropdown-menu alert-dialog table breadcrumb tooltip tabs badge separator avatar sheet switch scroll-area dialog skeleton
```

Accept all prompts. This installs components into `src/components/ui/` and adds any missing deps.

**Step 2: Verify installation**

```bash
ls src/components/ui/
```

Expected: All new component files present alongside existing button, card, checkbox, input, textarea.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore(playground): install shadcn sidebar, dropdown, dialog, table, and other UI components"
```

---

### Task 2: Add ThemeProvider and dark mode toggle

**Files:**
- Create: `packages/panels/pages/_components/ThemeProvider.tsx`
- Create: `packages/panels/pages/_components/ThemeToggle.tsx`

**Step 1: Create ThemeProvider**

Create `packages/panels/pages/_components/ThemeProvider.tsx`:

```tsx
'use client'

import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  resolved: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
  resolved: 'light',
})

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children, defaultTheme = 'system', storageKey = 'panels-theme' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(storageKey) as Theme | null
    if (stored) setThemeState(stored)
    setMounted(true)
  }, [storageKey])

  const resolved = theme === 'system' ? getSystemTheme() : theme

  useEffect(() => {
    if (!mounted) return
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(resolved)
  }, [resolved, mounted])

  useEffect(() => {
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () => {
        const r = mq.matches ? 'dark' : 'light'
        document.documentElement.classList.remove('light', 'dark')
        document.documentElement.classList.add(r)
      }
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [theme])

  function setTheme(t: Theme) {
    setThemeState(t)
    localStorage.setItem(storageKey, t)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
```

**Step 2: Create ThemeToggle**

Create `packages/panels/pages/_components/ThemeToggle.tsx`:

```tsx
'use client'

import { useTheme } from './ThemeProvider.js'

export function ThemeToggle() {
  const { resolved, setTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
      className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
      title={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {resolved === 'dark' ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      )}
    </button>
  )
}
```

**Step 3: Commit**

```bash
git add packages/panels/pages/_components/ThemeProvider.tsx packages/panels/pages/_components/ThemeToggle.tsx
git commit -m "feat(panels): add ThemeProvider and ThemeToggle for dark/light mode"
```

---

### Task 3: Rewrite AdminLayout with shadcn Sidebar

This is the largest task. Replace the hand-rolled sidebar with shadcn's `Sidebar` component, replace `UserDropdown` with `DropdownMenu`, and wrap everything in `ThemeProvider`.

**Files:**
- Modify: `packages/panels/pages/_components/AdminLayout.tsx`

**Step 1: Rewrite AdminLayout**

Replace the entire file `packages/panels/pages/_components/AdminLayout.tsx` with:

```tsx
import '@/index.css'
import { useState, useEffect, useRef } from 'react'
import { Toaster } from 'sonner'
import type { PanelMeta } from '@boostkit/panels'
import { GlobalSearch } from './GlobalSearch.js'
import { ThemeProvider, useTheme } from './ThemeProvider.js'
import { ThemeToggle } from './ThemeToggle.js'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.js'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar.js'
import { Separator } from '@/components/ui/separator.js'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb.js'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip.js'

interface Props {
  panelMeta:    PanelMeta
  currentSlug?: string
  initialUser?: SessionUser
  children:     React.ReactNode
}

interface NavItem {
  slug:  string
  label: string
  icon:  string | undefined
  href:  string
}

interface SessionUser {
  name?:  string
  email?: string
  image?: string
}

function buildNavItems(panelMeta: PanelMeta): NavItem[] {
  const path = panelMeta.path
  return [
    ...panelMeta.resources.map((r) => ({ slug: r.slug, label: r.label, icon: r.icon, href: `${path}/${r.slug}` })),
    ...panelMeta.pages.map((p)     => ({ slug: p.slug, label: p.label, icon: p.icon, href: `${path}/${p.slug}` })),
  ]
}

function useNavItemsWithPersistedState(panelMeta: PanelMeta): NavItem[] {
  const base = buildNavItems(panelMeta)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return base
  const segment = panelMeta.path.replace(/^\//, '')
  return base.map((item) => {
    const resource = panelMeta.resources.find((r) => r.slug === item.slug)
    if (!resource?.persistTableState) return item
    const saved = sessionStorage.getItem(`panels:${segment}:${item.slug}:tableState`)
    return saved ? { ...item, href: item.href + saved } : item
  })
}

function useSessionUser(initial?: SessionUser): SessionUser | null {
  const [user, setUser] = useState<SessionUser | null>(initial ?? null)
  useEffect(() => {
    if (initial !== undefined) return
    fetch('/api/auth/get-session')
      .then(r => r.ok ? r.json() : null)
      .then((data: { user?: SessionUser } | null) => { if (data?.user) setUser(data.user) })
      .catch(() => {})
  }, [])
  return user
}

function UserDropdown({ user, i18n }: { user: SessionUser | null; i18n: PanelMeta['i18n'] }) {
  if (!user) return null
  const initials = (user.name ?? user.email ?? '?').slice(0, 2).toUpperCase()

  async function handleSignOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' })
    window.location.href = '/login'
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors outline-none">
          <Avatar className="h-6 w-6 text-[10px]">
            {user.image && <AvatarImage src={user.image} alt={user.name ?? ''} />}
            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden sm:inline text-sm">{user.name ?? user.email}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            {user.name && <p className="text-sm font-medium">{user.name}</p>}
            {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={handleSignOut}>
          {i18n.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SidebarLayout({ panelMeta, currentSlug, initialUser, children }: Props & { currentSlug: string }) {
  const items = useNavItemsWithPersistedState(panelMeta)
  const user  = useSessionUser(initialUser)
  const i18n  = panelMeta.i18n
  const dir   = panelMeta.dir ?? 'ltr'
  const branding = panelMeta.branding

  return (
    <SidebarProvider>
      <div dir={dir} className="flex h-screen w-full">
        <Sidebar side={dir === 'rtl' ? 'right' : 'left'} collapsible="icon">
          <SidebarHeader className="border-b">
            <div className="flex items-center gap-2 px-2 py-1">
              {branding?.logo
                ? <img src={branding.logo} alt={branding?.title ?? panelMeta.name} className="h-6" />
                : <span className="text-sm font-semibold truncate">{branding?.title ?? panelMeta.name}</span>
              }
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.slug}>
                      <SidebarMenuButton asChild isActive={item.slug === currentSlug} tooltip={item.label}>
                        <a href={item.href}>
                          {item.icon && <span className="text-base leading-none">{item.icon}</span>}
                          <span>{item.label}</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t">
            <div className="flex items-center justify-between px-2 py-1">
              <UserDropdown user={user} i18n={i18n} />
            </div>
          </SidebarFooter>
        </Sidebar>

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-14 shrink-0 border-b flex items-center gap-2 px-4">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm text-muted-foreground flex-1">
              {items.find(i => i.slug === currentSlug)?.label ?? ''}
            </span>
            <GlobalSearch panelMeta={panelMeta} pathSegment={panelMeta.path.replace(/^\//, '')} />
            <ThemeToggle />
          </header>
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
      <Toaster richColors position="bottom-right" />
    </SidebarProvider>
  )
}

function TopbarLayout({ panelMeta, currentSlug, initialUser, children }: Props & { currentSlug: string }) {
  const items = useNavItemsWithPersistedState(panelMeta)
  const user  = useSessionUser(initialUser)
  const i18n  = panelMeta.i18n
  const dir   = panelMeta.dir ?? 'ltr'
  const branding = panelMeta.branding

  return (
    <div dir={dir} className="flex flex-col h-screen bg-background overflow-hidden">
      <header className="h-14 shrink-0 border-b bg-card flex items-center gap-4 px-6">
        <div className="flex items-center gap-2 me-2">
          {branding?.logo
            ? <img src={branding.logo} alt={branding?.title ?? panelMeta.name} className="h-6" />
            : <span className="text-sm font-semibold">{branding?.title ?? panelMeta.name}</span>
          }
        </div>
        <Separator orientation="vertical" className="h-4" />
        <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
          {items.map((item) => (
            <a
              key={item.slug}
              href={item.href}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors',
                item.slug === currentSlug
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              ].join(' ')}
            >
              {item.icon && <span className="text-base leading-none">{item.icon}</span>}
              {item.label}
            </a>
          ))}
        </nav>
        <GlobalSearch panelMeta={panelMeta} pathSegment={panelMeta.path.replace(/^\//, '')} />
        <ThemeToggle />
        <UserDropdown user={user} i18n={i18n} />
      </header>
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
      <Toaster richColors position="bottom-right" />
    </div>
  )
}

export default function AdminLayout({ panelMeta, currentSlug, initialUser, children }: Props) {
  const slug = currentSlug ?? ''
  const content = panelMeta.layout === 'topbar'
    ? <TopbarLayout panelMeta={panelMeta} currentSlug={slug} initialUser={initialUser}>{children}</TopbarLayout>
    : <SidebarLayout panelMeta={panelMeta} currentSlug={slug} initialUser={initialUser}>{children}</SidebarLayout>

  return (
    <TooltipProvider>
      <ThemeProvider>
        {content}
      </ThemeProvider>
    </TooltipProvider>
  )
}
```

**Step 2: Verify playground still loads**

```bash
cd /Users/sleman/Projects/boostkit/.claude/worktrees/panels-shadcn-ui/playground
pnpm artisan vendor:publish --tag=panels-pages --force
pnpm dev
```

Open `http://localhost:3000/admin` — sidebar should render with shadcn components, dark mode toggle visible.

**Step 3: Commit**

```bash
git add packages/panels/pages/_components/AdminLayout.tsx
git commit -m "feat(panels): rewrite AdminLayout with shadcn Sidebar, DropdownMenu, and dark mode"
```

---

### Task 4: Replace ConfirmDialog with shadcn AlertDialog

**Files:**
- Modify: `packages/panels/pages/_components/ConfirmDialog.tsx`

**Step 1: Rewrite ConfirmDialog**

Replace `packages/panels/pages/_components/ConfirmDialog.tsx` with:

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog.js'

interface Props {
  open:          boolean
  onClose:       () => void
  onConfirm:     () => void
  title:         string
  message:       string
  danger?:       boolean
  confirmLabel?: string
  cancelLabel?:  string
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger, confirmLabel = 'Confirm', cancelLabel = 'Cancel' }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={danger ? 'bg-destructive text-white hover:bg-destructive/90' : ''}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

**Step 2: Commit**

```bash
git add packages/panels/pages/_components/ConfirmDialog.tsx
git commit -m "feat(panels): replace ConfirmDialog with shadcn AlertDialog"
```

---

### Task 5: Replace GlobalSearch with shadcn Dialog + Command pattern

**Files:**
- Modify: `packages/panels/pages/_components/GlobalSearch.tsx`

**Step 1: Rewrite GlobalSearch**

Replace `packages/panels/pages/_components/GlobalSearch.tsx` with a version that uses shadcn `Dialog` for the overlay and keeps the existing keyboard handling and API fetching logic. The search input, results list, and keyboard navigation stay the same but use shadcn styling.

```tsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { navigate } from 'vike/client/router'
import type { PanelMeta } from '@boostkit/panels'
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
  panelMeta:    PanelMeta
  pathSegment:  string
}

export function GlobalSearch({ panelMeta, pathSegment }: Props) {
  const i18n = panelMeta.i18n
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

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
    void navigate(`/${pathSegment}/${item.resource}/${item.id}`)
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
        <span className="hidden sm:inline">{i18n.globalSearch ?? 'Search…'}</span>
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
              placeholder={i18n.globalSearch ?? 'Search everything…'}
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
```

**Step 2: Commit**

```bash
git add packages/panels/pages/_components/GlobalSearch.tsx
git commit -m "feat(panels): rewrite GlobalSearch with shadcn Dialog"
```

---

### Task 6: Update Breadcrumbs to use shadcn Breadcrumb

**Files:**
- Modify: `packages/panels/pages/_components/Breadcrumbs.tsx`

**Step 1: Rewrite Breadcrumbs**

Replace `packages/panels/pages/_components/Breadcrumbs.tsx` with:

```tsx
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb.js'

interface Crumb {
  label: string
  href?: string
}

interface Props {
  crumbs: Crumb[]
}

export function Breadcrumbs({ crumbs }: Props) {
  return (
    <Breadcrumb className="mb-6">
      <BreadcrumbList>
        {crumbs.map((crumb, i) => (
          <BreadcrumbItem key={i}>
            {i > 0 && <BreadcrumbSeparator />}
            {crumb.href
              ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink>
              : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
            }
          </BreadcrumbItem>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
```

**Step 2: Commit**

```bash
git add packages/panels/pages/_components/Breadcrumbs.tsx
git commit -m "feat(panels): replace Breadcrumbs with shadcn Breadcrumb"
```

---

### Task 7: Update table page with shadcn Table, Badge, Tooltip

**Files:**
- Modify: `packages/panels/pages/@panel/@resource/+Page.tsx`

This is the largest page. The changes are targeted — replace raw `<table>` elements with shadcn `Table` components, replace inline badge styling with `Badge`, and add `Tooltip` to action buttons. The business logic, state management, and event handlers stay identical.

**Step 1: Update imports at the top of the file**

Add these imports (keep all existing ones):

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.js'
import { Badge } from '@/components/ui/badge.js'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip.js'
```

**Step 2: Replace `<table>` with shadcn Table**

In the JSX, find the `<table className="w-full text-sm">` block and replace:
- `<table ...>` → `<Table>`
- `<thead>` → `<TableHeader>`
- `<tbody ...>` → `<TableBody>`
- `<tr ...>` in thead → `<TableRow>`
- `<th ...>` → `<TableHead>` (move classes to className)
- `<tr ...>` in tbody → `<TableRow>`
- `<td ...>` → `<TableCell>` (move classes to className)

**Step 3: Replace boolean badges in CellValue**

In the `CellValue` function, find the boolean rendering and replace with `Badge`:

```tsx
if (type === 'boolean' || type === 'toggle') {
  return <Badge variant={value ? 'default' : 'secondary'}>{value ? i18n.yes : i18n.no}</Badge>
}
```

Replace tags rendering:
```tsx
if (type === 'tags') {
  const arr = Array.isArray(value) ? value : []
  return (
    <span className="flex flex-wrap gap-1">
      {arr.map((tag, i) => <Badge key={i} variant="outline">{String(tag)}</Badge>)}
    </span>
  )
}
```

**Step 4: Add Tooltip to row action buttons**

Wrap each row action button with Tooltip:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <button ...>{action.label}</button>
  </TooltipTrigger>
  <TooltipContent>{action.label}</TooltipContent>
</Tooltip>
```

**Step 5: Commit**

```bash
git add packages/panels/pages/@panel/@resource/+Page.tsx
git commit -m "feat(panels): upgrade table page with shadcn Table, Badge, and Tooltip components"
```

---

### Task 8: Update edit page form sections with shadcn Tabs

**Files:**
- Modify: `packages/panels/pages/@panel/@resource/@id/edit/+Page.tsx`
- Modify: `packages/panels/pages/@panel/@resource/create/+Page.tsx`

**Step 1: Update edit page**

In the edit page's `renderSchemaItem` function, replace the hand-rolled tabs with shadcn `Tabs`:

Add import:
```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.js'
```

Replace the tabs rendering block:
```tsx
if (item.type === 'tabs') {
  const tabsMeta = item as TabsMeta
  const key = `tabs-${index}`
  return (
    <Tabs key={key} defaultValue={tabsMeta.tabs[0]?.label} className="rounded-xl border border-border bg-card">
      <TabsList className="w-full justify-start rounded-none border-b bg-muted/40 px-2">
        {tabsMeta.tabs.map((tab) => (
          <TabsTrigger key={tab.label} value={tab.label} className="text-sm">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabsMeta.tabs.map((tab) => (
        <TabsContent key={tab.label} value={tab.label} className="p-5 flex flex-col gap-4 mt-0">
          {tab.fields
            .filter((f) => !f.hidden.includes('edit') && isFieldVisible(f as { conditions?: Condition[] }, values))
            .map((f) => renderField(f))
          }
        </TabsContent>
      ))}
    </Tabs>
  )
}
```

**Step 2: Apply same change to create page**

Apply the identical tabs change to `packages/panels/pages/@panel/@resource/create/+Page.tsx`.

**Step 3: Commit**

```bash
git add packages/panels/pages/@panel/@resource/@id/edit/+Page.tsx packages/panels/pages/@panel/@resource/create/+Page.tsx
git commit -m "feat(panels): upgrade form tabs with shadcn Tabs component"
```

---

### Task 9: Publish pages and test

**Step 1: Publish updated pages to playground**

```bash
cd /Users/sleman/Projects/boostkit/.claude/worktrees/panels-shadcn-ui/playground
pnpm artisan vendor:publish --tag=panels-pages --force
```

**Step 2: Start playground and test**

```bash
pnpm dev
```

Test checklist:
- [ ] Sidebar renders with shadcn Sidebar (collapsible, icon mode)
- [ ] Dark mode toggle works (persists across refresh)
- [ ] UserDropdown uses shadcn DropdownMenu
- [ ] Confirm dialogs use shadcn AlertDialog
- [ ] Global search uses shadcn Dialog
- [ ] Breadcrumbs use shadcn Breadcrumb
- [ ] Table uses shadcn Table components
- [ ] Boolean fields show shadcn Badge
- [ ] Tags show outline Badge
- [ ] Form tabs use shadcn Tabs
- [ ] RTL layout still works (`dir="rtl"`)
- [ ] Topbar layout still works

**Step 3: Fix any issues found during testing**

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(panels): resolve issues from shadcn UI migration testing"
```

---

### Task 10: Update docs

**Files:**
- Modify: `docs/packages/panels.md`
- Modify: `packages/panels/README.md`

**Step 1: Add dark mode section to docs**

Add to the panels docs after the i18n section:

```markdown
## Dark Mode

The panel UI supports light, dark, and system-based themes. A toggle button appears in the header.

Theme is persisted to `localStorage` under the key `panels-theme`.

The theme system uses class-based toggling (`.dark` on `<html>`) which works with Tailwind CSS v4's built-in dark mode support. All panel components respect the current theme automatically.

### Customizing Colors

Override CSS variables in your `src/index.css` to customize both light and dark themes:

\`\`\`css
:root {
  --primary: oklch(0.5 0.2 250);
  --sidebar: oklch(0.97 0 0);
}

.dark {
  --primary: oklch(0.7 0.15 250);
  --sidebar: oklch(0.15 0 0);
}
\`\`\`
```

**Step 2: Add shadcn dependency note**

Add a note in the Installation section:

```markdown
The panel UI uses [shadcn/ui](https://ui.shadcn.com) components. After publishing panel pages, ensure shadcn components are installed in your app:

\`\`\`bash
npx shadcn@latest add sidebar dropdown-menu alert-dialog table breadcrumb tooltip tabs badge separator avatar sheet switch dialog
\`\`\`
```

**Step 3: Commit**

```bash
git add docs/packages/panels.md packages/panels/README.md
git commit -m "docs(panels): add dark mode and shadcn dependency documentation"
```
