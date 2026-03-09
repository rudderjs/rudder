import '@/index.css'
import type { PanelMeta } from '@boostkit/panels'

interface Props {
  panelMeta:    PanelMeta
  currentSlug?: string
  children:     React.ReactNode
}

interface InternalProps {
  panelMeta:   PanelMeta
  currentSlug: string
  children:    React.ReactNode
}

interface NavItem {
  slug:  string
  label: string
  icon:  string | undefined
  href:  string
}

function buildNavItems(panelMeta: PanelMeta): NavItem[] {
  const path = panelMeta.path
  return [
    ...panelMeta.resources.map((r) => ({ slug: r.slug, label: r.label, icon: r.icon,        href: `${path}/${r.slug}` })),
    ...panelMeta.pages.map((p)     => ({ slug: p.slug, label: p.label, icon: p.icon,        href: `${path}/${p.slug}` })),
  ]
}

export function AdminLayout({ panelMeta, currentSlug, children }: Props) {
  const slug = currentSlug ?? ''
  return panelMeta.layout === 'topbar'
    ? <TopbarLayout panelMeta={panelMeta} currentSlug={slug}>{children}</TopbarLayout>
    : <SidebarLayout panelMeta={panelMeta} currentSlug={slug}>{children}</SidebarLayout>
}

// ─── Sidebar Layout ─────────────────────────────────────────

function SidebarLayout({ panelMeta, currentSlug, children }: InternalProps) {
  const brand    = panelMeta.branding?.title ?? panelMeta.name
  const navItems = buildNavItems(panelMeta)
  const current  = navItems.find((n) => n.slug === currentSlug)

  return (
    <div className="flex h-screen bg-background overflow-hidden">

      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r bg-card flex flex-col">

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
        <header className="h-14 shrink-0 border-b flex items-center px-6">
          <span className="text-sm font-medium text-muted-foreground">
            {current?.label ?? brand}
          </span>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

    </div>
  )
}

// ─── Topbar Layout ──────────────────────────────────────────

function TopbarLayout({ panelMeta, currentSlug, children }: InternalProps) {
  const brand    = panelMeta.branding?.title ?? panelMeta.name
  const navItems = buildNavItems(panelMeta)

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">

      {/* Topbar */}
      <header className="h-14 shrink-0 border-b bg-card flex items-center gap-6 px-6">

        {/* Brand */}
        <div className="flex items-center gap-2 mr-2">
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

      </header>

      {/* Main */}
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>

    </div>
  )
}
