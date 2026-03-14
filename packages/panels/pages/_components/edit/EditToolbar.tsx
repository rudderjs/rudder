import type { PanelI18n } from '@boostkit/panels'
import { t } from '../../_lib/formHelpers.js'

interface Presence { name: string; color: string }

interface Props {
  collaborative:  boolean
  versioned:      boolean
  draftable:      boolean
  connected:      boolean
  presences:      Presence[]
  recordStatus:   string | null
  showHistory:    boolean
  onToggleHistory: () => void
  i18n:           PanelI18n & Record<string, string>
}

export function EditToolbar({
  collaborative, versioned, draftable,
  connected, presences, recordStatus,
  showHistory, onToggleHistory, i18n,
}: Props) {
  if (!collaborative && !versioned && !draftable) return null

  return (
    <div className="flex items-center gap-3 mb-4 text-sm">
      {collaborative && (
        <span className={`inline-flex items-center gap-1.5 ${connected ? 'text-green-600' : 'text-muted-foreground'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-muted-foreground'}`} />
          {connected ? (i18n.connectedLive ?? 'Connected') : (i18n.disconnectedLive ?? 'Disconnected')}
        </span>
      )}

      {collaborative && presences.length > 1 && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <span className="flex -space-x-1.5">
            {presences.slice(0, 5).map((p, i) => (
              <span
                key={i}
                className="w-5 h-5 rounded-full border border-background text-[10px] font-medium flex items-center justify-center text-white"
                style={{ backgroundColor: p.color }}
                title={p.name}
              >
                {p.name[0]}
              </span>
            ))}
          </span>
          {t(i18n.editingNow ?? ':n editing', { n: presences.length })}
        </span>
      )}

      {draftable && recordStatus && (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          recordStatus === 'published'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
        }`}>
          {recordStatus === 'published' ? (i18n.publishedBadge ?? 'Published') : (i18n.draftBadge ?? 'Draft')}
        </span>
      )}

      <div className="flex-1" />

      {versioned && (
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={onToggleHistory}
        >
          {i18n.versionHistory ?? 'Version History'}
        </button>
      )}
    </div>
  )
}
