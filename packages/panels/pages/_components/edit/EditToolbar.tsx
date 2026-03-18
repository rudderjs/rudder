import type { PanelI18n } from '@boostkit/panels'
import { t } from '../../_lib/formHelpers.js'
import type { AutosaveStatus } from '../../_hooks/useAutosave.js'

interface Presence { name: string; color: string }

interface Props {
  yjs:  boolean
  versioned:      boolean
  draftable:      boolean
  connected:      boolean
  presences:      Presence[]
  recordStatus:   string | null
  showHistory:    boolean
  onToggleHistory: () => void
  i18n:           PanelI18n & Record<string, string>
  autosave?:      boolean
  autosaveStatus?: AutosaveStatus
  autosaveDirty?: boolean
}

export function EditToolbar({
  yjs, versioned, draftable,
  connected, presences, recordStatus,
  showHistory: _showHistory, onToggleHistory, i18n,
  autosave, autosaveStatus, autosaveDirty,
}: Props) {
  if (!yjs && !versioned && !draftable && !autosave) return null

  return (
    <div className="flex items-center gap-3 mb-4 text-sm">
      {yjs && (
        <span className={`inline-flex items-center gap-1.5 ${connected ? 'text-green-600' : 'text-muted-foreground'}`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-muted-foreground'}`} />
          {connected ? (i18n.connectedLive ?? 'Connected') : (i18n.disconnectedLive ?? 'Disconnected')}
        </span>
      )}

      {yjs && presences.length > 1 && (
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

      {autosave && (
        <span className={`inline-flex items-center gap-1.5 text-xs ${
          autosaveStatus === 'saving' ? 'text-muted-foreground' :
          autosaveStatus === 'saved' ? 'text-green-600 dark:text-green-400' :
          autosaveStatus === 'error' ? 'text-red-600 dark:text-red-400' :
          autosaveDirty ? 'text-amber-600 dark:text-amber-400' :
          'text-muted-foreground'
        }`}>
          {autosaveStatus === 'saving' && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              {i18n.autosaving ?? 'Saving\u2026'}
            </>
          )}
          {autosaveStatus === 'saved' && (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {i18n.autosaved ?? 'Saved'}
            </>
          )}
          {autosaveStatus === 'error' && (i18n.saveError ?? 'Save failed')}
          {(autosaveStatus === 'idle' && autosaveDirty) && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {i18n.unsavedChanges ?? 'Unsaved changes'}
            </>
          )}
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
