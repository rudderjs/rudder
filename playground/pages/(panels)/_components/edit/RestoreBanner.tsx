import type { PanelI18n } from '@pilotiq/panels'
import { t } from '../../_lib/formHelpers.js'

interface Props {
  timestamp: number
  onRestore: () => void
  onDismiss: () => void
  i18n: PanelI18n & Record<string, string>
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - ts

  // Less than a minute ago
  if (diff < 60_000) return 'just now'

  // Less than an hour
  if (diff < 3_600_000) {
    const mins = Math.floor(diff / 60_000)
    return `${mins}m ago`
  }

  // Today — show time
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }

  // Older — show date + time
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function RestoreBanner({ timestamp, onRestore, onDismiss, i18n }: Props) {
  const time = formatTime(timestamp)

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 mb-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300 text-sm">
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span className="flex-1">
        {t(i18n.restoreDraft ?? 'You have unsaved changes from :time. Restore them?', { time })}
      </span>
      <button
        type="button"
        onClick={onRestore}
        className="px-3 py-1 text-xs font-medium rounded-md bg-amber-200 text-amber-900 hover:bg-amber-300 dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700 transition-colors"
      >
        {i18n.restoreDraftButton ?? 'Restore'}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="px-3 py-1 text-xs font-medium text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 transition-colors"
      >
        {i18n.discardDraft ?? 'Discard'}
      </button>
    </div>
  )
}
