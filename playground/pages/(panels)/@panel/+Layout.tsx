'use client'

import { Component, type ReactNode } from 'react'
import { usePageContext } from 'vike-react/usePageContext'
import { AdminLayout }    from '../_components/AdminLayout.js'
import type { PanelMeta } from '@boostkit/panels'
// Optionally register Lexical editor if @boostkit/panels-lexical is installed.
// Dynamic import avoids a hard dependency and breaks the panels ↔ panels-lexical cycle.
import('@boostkit/panels-lexical').then(({ registerLexical }) => registerLexical()).catch(() => {})

// Register lazy-loaded plugin elements (synchronous — just stores factory, no actual import)
import { registerLazyElement } from '@boostkit/panels'
try {
  registerLazyElement('media', () => import('@boostkit/media').then(m => ({ default: (m as Record<string, unknown>).MediaElement as React.ComponentType })))
} catch {}

// ── Error Boundary ──────────────────────────────────────────────────────────

interface ErrorBoundaryState {
  error: Error | null
}

class PanelErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const isSerializationError = error.message?.includes('pageContext.data') || error.message?.includes('serializ')

    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
        <p className="text-7xl font-black tracking-tighter text-red-500/20 select-none">Error</p>
        <div className="flex flex-col gap-2 max-w-lg">
          <h1 className="text-xl font-semibold tracking-tight text-red-600 dark:text-red-400">Panel failed to render</h1>
          <pre className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-4 text-left overflow-auto max-h-48 whitespace-pre-wrap">
            {error.message}
          </pre>
          {isSerializationError && (
            <p className="text-sm text-muted-foreground mt-2">
              This usually means a schema element returned non-serializable data (function, class instance, Date).
              Check the server console for <code className="text-xs bg-muted px-1 py-0.5 rounded">[panels] Non-serializable values</code> warnings.
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-accent transition-colors"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Reload page
          </button>
        </div>
      </div>
    )
  }
}

// ── Layout ──────────────────────────────────────────────────────────────────

export default function PanelLayout({ children }: { children: ReactNode }) {
  let data: { panelMeta: PanelMeta; slug?: string; sessionUser?: { name?: string; email?: string; image?: string } }

  try {
    const ctx = usePageContext() as { data: typeof data }
    data = ctx.data
  } catch (e) {
    // pageContext.data access can throw if not serializable
    return (
      <PanelErrorBoundary>
        <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
          <p className="text-7xl font-black tracking-tighter text-red-500/20 select-none">Error</p>
          <div className="flex flex-col gap-2 max-w-lg">
            <h1 className="text-xl font-semibold tracking-tight text-red-600 dark:text-red-400">Panel data failed to load</h1>
            <pre className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-4 text-left overflow-auto max-h-48 whitespace-pre-wrap">
              {e instanceof Error ? e.message : String(e)}
            </pre>
            <p className="text-sm text-muted-foreground mt-2">
              Check the server console for <code className="text-xs bg-muted px-1 py-0.5 rounded">[panels] Non-serializable values</code> warnings.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Reload page
          </button>
        </div>
      </PanelErrorBoundary>
    )
  }

  return (
    <PanelErrorBoundary>
      <AdminLayout panelMeta={data.panelMeta} currentSlug={data.slug ?? ''} {...(data.sessionUser !== undefined ? { initialUser: data.sessionUser } : {})}>
        {children}
      </AdminLayout>
    </PanelErrorBoundary>
  )
}
