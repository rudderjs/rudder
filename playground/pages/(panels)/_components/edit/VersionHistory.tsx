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
  i18n:           PanelI18n & Record<string, string>
}

export function VersionHistory({ pathSegment, slug, id, onRestore, i18n }: Props) {
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
          {loading && <p className="text-sm text-muted-foreground">{i18n.loading}</p>}
          {!loading && versions.length === 0 && (
            <p className="text-sm text-muted-foreground">{i18n.noVersions ?? 'No versions yet.'}</p>
          )}
          {versions.map((v) => (
            <div key={v.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div>
                <p className="text-sm">{v.label ?? new Date(v.createdAt).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">{new Date(v.createdAt).toLocaleString()}</p>
              </div>
              <button
                type="button"
                className="text-xs text-primary hover:underline"
                onClick={() => onRestore(v.id)}
              >
                {i18n.restore ?? 'Restore'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
