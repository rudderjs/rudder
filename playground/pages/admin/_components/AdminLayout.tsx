import '@/index.css'
import type { PanelMeta } from '@boostkit/panels'

interface Props {
  panelMeta:    PanelMeta
  currentSlug?: string
  children:     React.ReactNode
}

export function AdminLayout({ panelMeta, currentSlug, children }: Props) {
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">

      {/* ── Sidebar ───────────────────────────────────────────── */}
      <aside className="w-60 flex-shrink-0 bg-slate-900 text-white flex flex-col">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-slate-700">
          <span className="text-base font-semibold tracking-tight">
            {panelMeta.branding.title ?? panelMeta.name}
          </span>
        </div>

        {/* Resource nav */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <p className="px-5 mb-1 text-xs font-medium text-slate-500 uppercase tracking-wider">
            Resources
          </p>
          {panelMeta.resources.map((r) => {
            const active = r.slug === currentSlug
            return (
              <a
                key={r.slug}
                href={`/admin/${r.slug}`}
                className={[
                  'flex items-center gap-2 px-5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                ].join(' ')}
              >
                {r.label}
              </a>
            )
          })}
        </nav>
      </aside>

      {/* ── Main ──────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-8">
          {children}
        </div>
      </main>
    </div>
  )
}
