import { useState } from 'react'
import type { PanelI18n } from '@boostkit/panels'

export interface VersionEntry {
  id:        string
  label?:    string
  createdAt: string
  userId?:   string
}

interface Props {
  pathSegment:    string
  slug:           string
  id:             string
  onRestore:      (versionId: string) => void
  onRejoinLive?:  () => void
  i18n:           PanelI18n & Record<string, string>
  /** ID of the currently restored/active version (if any) */
  activeVersionId?: string | null
  /** True when the form is in restore preview mode (non-collaborative) */
  isRestorePreview?: boolean
}

export function VersionHistory({ pathSegment, slug, id, onRestore, onRejoinLive, i18n, activeVersionId, isRestorePreview }: Props) {
  const [versions, setVersions]           = useState<VersionEntry[]>([])
  const [loading, setLoading]             = useState(false)
  const [loaded, setLoaded]               = useState(false)

  async function loadVersions() {
    if (loaded) return
    setLoading(true)
    try {
      const res = await fetch(`/${pathSegment}/api/${slug}/${id}/_versions`)
      if (res.ok) {
        const body = await res.json() as { data: VersionEntry[] }
        setVersions(body.data ?? [])
      }
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  // Load on first render
  if (!loaded && !loading) void loadVersions()

  return (
    <div className="w-72 shrink-0">
      <div className="rounded-xl border border-border bg-card">
        <div className="px-4 py-3 border-b border-border bg-muted/40">
          <p className="text-sm font-semibold">{i18n.versionHistory ?? 'Version History'}</p>
        </div>
        <div className="p-3 max-h-96 overflow-y-auto">
          {/* Rejoin Live button — shown when in restore preview mode */}
          {isRestorePreview && onRejoinLive && (
            <button
              type="button"
              className="w-full mb-3 px-3 py-2 text-xs font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90"
              onClick={onRejoinLive}
            >
              {i18n.rejoinLive ?? 'Back to Live Editing'}
            </button>
          )}

          {loading && <p className="text-sm text-muted-foreground">{i18n.loading}</p>}
          {!loading && versions.length === 0 && (
            <p className="text-sm text-muted-foreground">{i18n.noVersions ?? 'No versions yet.'}</p>
          )}
          {versions.map((v, idx) => {
            const isActive = v.id === activeVersionId || (!activeVersionId && idx === 0)
            return (
              <div
                key={v.id}
                className={`flex items-center justify-between py-2 border-b border-border last:border-0 ${isActive ? 'bg-primary/5 -mx-3 px-3 rounded-md' : ''}`}
              >
                <div className="flex items-center gap-2">
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                  <div>
                    <p className="text-sm">{v.label ?? new Date(v.createdAt).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                {!isActive && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline shrink-0"
                    onClick={() => onRestore(v.id)}
                  >
                    {i18n.restore ?? 'Restore'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
