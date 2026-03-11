import '@/index.css'
import { useState, useEffect, useRef } from 'react'
import { Toaster } from 'sonner'
import type { PanelMeta } from '@boostkit/panels'
import { GlobalSearch } from './GlobalSearch.js'

interface Props {
  panelMeta:    PanelMeta
  currentSlug?: string
  initialUser?: SessionUser
  children:     React.ReactNode
}

interface InternalProps {
  panelMeta:    PanelMeta
  currentSlug:  string
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

/** Enhance nav hrefs with persisted query strings (client-only). */
function useNavItemsWithPersistedState(panelMeta: PanelMeta): NavItem[] {
  const base = buildNavItems(panelMeta)
  const [items, setItems] = useState(base)

  useEffect(() => {
    const segment = panelMeta.path.replace(/^\//, '')
    const enhanced = base.map((item) => {
      const resource = panelMeta.resources.find((r) => r.slug === item.slug)
      if (!resource?.persistFilters) return item
      const saved = sessionStorage.getItem(`panels:${segment}:${item.slug}:tableState`)
      return saved ? { ...item, href: item.href + saved } : item
    })
    setItems(enhanced)
  }) // no deps — re-run on every render so hrefs stay up-to-date

  return items
}

function useSessionUser(initial?: SessionUser): SessionUser | null {
  const [user, setUser] = useState<SessionUser | null>(initial ?? null)
  useEffect(() => {
    if (initial !== undefined) return  // SSR-provided — no client fetch needed
    fetch('/api/auth/get-session')
      .then(r => r.ok ? r.json() : null)
      .then((data: { user?: SessionUser } | null) => { if (data?.user) setUser(data.user) })
      .catch(() => {})
  }, [])
  return user
}

export function AdminLayout({ panelMeta, currentSlug, initialUser, children }: Props) {
  const slug = currentSlug ?? ''
  return panelMeta.layout === 'topbar'
    ? <TopbarLayout panelMeta={panelMeta} currentSlug={slug} {...(initialUser !== undefined ? { initialUser } : {})}>{children}</TopbarLayout>
    : <SidebarLayout panelMeta={panelMeta} currentSlug={slug} {...(initialUser !== undefined ? { initialUser } : {})}>{children}</SidebarLayout>
}

// ─── User Dropdown ───────────────────────────────────────────

function UserDropdown({ user, signOutLabel }: { user: SessionUser; signOutLabel: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const initials = (user.name ?? user.email ?? '?')
    .split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()

  async function handleLogout() {
    await fetch('/api/auth/sign-out', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
    })
    window.location.href = '/login'
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
      >
        {user.image
          ? <img src={user.image} alt="" className="h-6 w-6 rounded-full object-cover" />
          : <span className="h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center">{initials}</span>
        }
        <span className="hidden sm:block text-sm font-medium max-w-[120px] truncate">
          {user.name ?? user.email}
        </span>
        <svg className="h-3.5 w-3.5 text-muted-foreground" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute rtl:left-0 rtl:right-auto right-0 top-full mt-1 w-52 rounded-lg border bg-popover shadow-md z-50 py-1">
          <div className="px-3 py-2 border-b">
            {user.name && <p className="text-sm font-medium truncate">{user.name}</p>}
            {user.email && <p className="text-xs text-muted-foreground truncate">{user.email}</p>}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full text-start px-3 py-2 text-sm text-destructive hover:bg-accent transition-colors"
          >
            {signOutLabel}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Sidebar Layout ─────────────────────────────────────────

function SidebarLayout({ panelMeta, currentSlug, initialUser, children }: InternalProps) {
  const brand    = panelMeta.branding?.title ?? panelMeta.name
  const navItems = useNavItemsWithPersistedState(panelMeta)
  const current  = navItems.find((n) => n.slug === currentSlug)
  const user     = useSessionUser(initialUser)
  const { i18n, dir } = panelMeta

  return (
    <div dir={dir} className="flex h-screen bg-background overflow-hidden">

      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-e bg-card flex flex-col">

        {/* Brand */}
        <div className="h-14 flex items-center gap-2 px-4 border-b">
          {panelMeta.branding?.logo
            ? <img src={panelMeta.branding.logo} alt={brand} className="h-6 w-auto" />
            : <span className="font-semibold text-sm tracking-tight truncate">{brand}</span>
          }
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {navItems.map((item) => {
            const active = item.slug === currentSlug
            return (
              <a
                key={item.slug}
                href={item.href}
                className={[
                  'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                ].join(' ')}
              >
                {item.icon && <span className="shrink-0 text-base leading-none">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
              </a>
            )
          })}
        </nav>

      </aside>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 shrink-0 border-b flex items-center gap-4 px-6">
          <span className="text-sm font-medium text-muted-foreground flex-1">
            {current?.label ?? brand}
          </span>
          <GlobalSearch panelMeta={panelMeta} pathSegment={panelMeta.path.replace(/^\//, '')} />
          {user && <UserDropdown user={user} signOutLabel={i18n.signOut} />}
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      {/* Toasts */}
      <Toaster richColors position="bottom-right" />
    </div>
  )
}

// ─── Topbar Layout ──────────────────────────────────────────

function TopbarLayout({ panelMeta, currentSlug, initialUser, children }: InternalProps) {
  const brand    = panelMeta.branding?.title ?? panelMeta.name
  const navItems = useNavItemsWithPersistedState(panelMeta)
  const user     = useSessionUser(initialUser)
  const { i18n, dir } = panelMeta

  return (
    <div dir={dir} className="flex flex-col h-screen bg-background overflow-hidden">

      {/* Topbar */}
      <header className="h-14 shrink-0 border-b bg-card flex items-center gap-6 px-6">

        {/* Brand */}
        <div className="flex items-center gap-2 me-2">
          {panelMeta.branding?.logo
            ? <img src={panelMeta.branding.logo} alt={brand} className="h-6 w-auto" />
            : <span className="font-semibold text-sm tracking-tight">{brand}</span>
          }
        </div>

        {/* Nav */}
        <nav className="flex items-center gap-1 flex-1 overflow-x-auto">
          {navItems.map((item) => {
            const active = item.slug === currentSlug
            return (
              <a
                key={item.slug}
                href={item.href}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                ].join(' ')}
              >
                {item.icon && <span className="text-base leading-none">{item.icon}</span>}
                {item.label}
              </a>
            )
          })}
        </nav>

        <GlobalSearch panelMeta={panelMeta} pathSegment={panelMeta.path.replace(/^\//, '')} />
        {user && <UserDropdown user={user} signOutLabel={i18n.signOut} />}

      </header>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>

      {/* Toasts */}
      <Toaster richColors position="bottom-right" />
    </div>
  )
}
