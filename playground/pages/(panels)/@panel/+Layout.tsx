'use client'

import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { usePageContext } from 'vike-react/usePageContext'
import { AdminLayout }    from '../_components/AdminLayout.js'
import { I18nProvider }   from '../_hooks/useI18n.js'
import { AiChatProvider } from '../_components/agents/AiChatContext.js'
import { generateThemeCSS } from '@pilotiq/panels'
import type { PanelNavigationMeta } from '@pilotiq/panels'
// Auto-discover plugin registrations (fields, lazy elements, etc.)
// Plugins publish _register-{name}.ts files that call registerField/registerLazyElement.
import.meta.glob('../_register-*.ts', { eager: true })
// Lexical uses registerField — only register on client to avoid SSR/client hydration mismatch
if (typeof window !== 'undefined') {
  import('@pilotiq/lexical').then(({ registerLexical }) => registerLexical()).catch(() => {})
}

// ── Collab provider (open-core seam) ────────────────────────────────────────
// If @pilotiq-pro/collab is installed, dynamically load its <CollabProvider>
// and wrap the panel tree in it. This activates real Yjs-backed collaboration
// for LexicalEditor / CollaborativePlainText by overriding the CollabHookContext
// that @pilotiq/lexical ships with a stub default.
//
// Without pro installed: the import fails, the state stays null, and the
// tree renders with the stub hook (local-only mode).
//
// SSR note: the stub and the real impl both return collabReady=false on first
// render (real impl's collab wiring runs inside useEffect, client-only), so
// hydration matches regardless of whether the Provider is present.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic-import type surface
function useCollabProvider(): ComponentType<{ children: ReactNode }> | null {
  const [Provider, setProvider] = useState<ComponentType<{ children: ReactNode }> | null>(null)
  useEffect(() => {
    let cancelled = false
    // Optional runtime dep — Vite must NOT statically resolve this specifier,
    // otherwise dev crashes with "Failed to resolve import" when pro isn't
    // installed (see pilotiq/docs/plans/phase-5-collab-extraction.md R5/R6).
    // Literal string + /* @vite-ignore */ is not enough in Vite 7 — the
    // import-analysis plugin still inspects the literal. The workaround is
    // a non-literal specifier (string concatenation) so static analysis
    // can't see the target at all; the import falls through to runtime
    // where .catch() handles "not installed" gracefully.
    const pkg = '@pilotiq-pro' + '/collab'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional dep surface
    import(/* @vite-ignore */ pkg)
      .then((mod: any) => { if (!cancelled && mod?.CollabProvider) setProvider(() => mod.CollabProvider) })
      .catch(() => { /* pro not installed — stay in local-only mode */ })
    return () => { cancelled = true }
  }, [])
  return Provider
}

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
  let data: { panelMeta: PanelNavigationMeta; slug?: string; sessionUser?: { name?: string; email?: string; image?: string } }

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

  // SSR: inject theme CSS inline to prevent FOUC
  const themeCss = data.panelMeta.theme ? generateThemeCSS(data.panelMeta.theme) : null

  const CollabProvider = useCollabProvider()
  const tree = (
    <AiChatProvider panelPath={data.panelMeta.path}>
      <I18nProvider i18n={data.panelMeta.i18n} locale={data.panelMeta.locale}>
        <AdminLayout panelMeta={data.panelMeta} currentSlug={data.slug ?? ''} {...(data.sessionUser !== undefined ? { initialUser: data.sessionUser } : {})}>
          {children}
        </AdminLayout>
      </I18nProvider>
    </AiChatProvider>
  )

  return (
    <PanelErrorBoundary>
      {themeCss && <style dangerouslySetInnerHTML={{ __html: themeCss }} />}
      {CollabProvider ? <CollabProvider>{tree}</CollabProvider> : tree}
    </PanelErrorBoundary>
  )
}
