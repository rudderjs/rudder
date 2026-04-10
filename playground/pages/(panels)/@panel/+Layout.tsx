'use client'

import { Component, type ReactNode } from 'react'
import { usePageContext } from 'vike-react/usePageContext'
import { AdminLayout }    from '../_components/AdminLayout.js'
import { I18nProvider }   from '../_hooks/useI18n.js'
import { generateThemeCSS } from '@pilotiq/panels'
import type { PanelNavigationMeta } from '@pilotiq/panels'
// PLAYGROUND-LOCAL OVERRIDE: static imports of pro packages.
//
// The canonical pilotiq vendored Layout uses dynamic imports with a
// string-concat specifier trick so apps without pro installed don't crash
// at dev startup. That pattern is broken in browsers — Vite's runtime
// dynamic-import helper does NOT resolve bare specifiers, only its static
// import analyzer does. So the dynamic version never actually loads pro
// packages on the client.
//
// The playground always has both pro packages linked, so we side-step the
// problem with static imports. The proper open-core fix (free `<AiUiProvider>`
// stub + Vite alias when pro is installed) is tracked as a Phase 4 follow-up.
//
// `vendor:publish --tag=pilotiq-pages` will overwrite this file. After a
// re-vendor, re-apply this patch (or pull from git).
// `@pilotiq-pro/collab` is not currently linked in this playground; collab
// runs in local-only mode via the `@pilotiq/lexical` stub. Add the package
// + link + optimizeDeps entry to enable real Yjs collaboration.
import { AiUiProvider } from '@pilotiq-pro/ai'
// Auto-discover plugin registrations (fields, lazy elements, etc.)
// Plugins publish _register-{name}.ts files that call registerField/registerLazyElement.
import.meta.glob('../_register-*.ts', { eager: true })
// Lexical uses registerField — only register on client to avoid SSR/client hydration mismatch
if (typeof window !== 'undefined') {
  import('@pilotiq/lexical').then(({ registerLexical }) => registerLexical()).catch(() => {})
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

  return (
    <PanelErrorBoundary>
      {themeCss && <style dangerouslySetInnerHTML={{ __html: themeCss }} />}
      <AiUiProvider panelPath={data.panelMeta.path}>
        <I18nProvider i18n={data.panelMeta.i18n} locale={data.panelMeta.locale}>
          <AdminLayout panelMeta={data.panelMeta} currentSlug={data.slug ?? ''} {...(data.sessionUser !== undefined ? { initialUser: data.sessionUser } : {})}>
            {children}
          </AdminLayout>
        </I18nProvider>
      </AiUiProvider>
    </PanelErrorBoundary>
  )
}
