import '@/index.css'
import type { PanelMeta } from '@boostkit/panels'

interface Props {
  panelMeta:    PanelMeta
  currentSlug?: string
  children:     React.ReactNode
}

export function AdminLayout({ panelMeta, currentSlug, children }: Props) {
  return panelMeta.layout === 'topbar'
    ? <TopbarLayout panelMeta={panelMeta} currentSlug={currentSlug}>{children}</TopbarLayout>
    : <SidebarLayout panelMeta={panelMeta} currentSlug={currentSlug}>{children}</SidebarLayout>
}

// ─── Sidebar Layout ─────────────────────────────────────────

function SidebarLayout({ panelMeta, currentSlug, children }: Props) {
  const brand = panelMeta.branding?.title ?? panelMeta.name
  const path  = panelMeta.path

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
          {panelMeta.resources.map((r) => {
            const active = r.slug === currentSlug
            return (
              <a
                key={r.slug}
                href={`${path}/${r.slug}`}
                className={[
                  'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                ].join(' ')}
              >
                {r.icon && <span className="shrink-0 text-base leading-none">{r.icon}</span>}
                <span className="truncate">{r.label}</span>
              </a>
            )
          })}
        </nav>

      </aside>

      {/* Content area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 shrink-0 border-b flex items-center px-6">
          <span className="text-sm font-medium text-muted-foreground">
            {panelMeta.resources.find(r => r.slug === currentSlug)?.label ?? brand}
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

function TopbarLayout({ panelMeta, currentSlug, children }: Props) {
  const brand = panelMeta.branding?.title ?? panelMeta.name
  const path  = panelMeta.path

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
          {panelMeta.resources.map((r) => {
            const active = r.slug === currentSlug
            return (
              <a
                key={r.slug}
                href={`${path}/${r.slug}`}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                ].join(' ')}
              >
                {r.icon && <span className="text-base leading-none">{r.icon}</span>}
                {r.label}
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
