import { ServiceProvider } from '@rudderjs/core'

export class PanelLexicalServiceProvider extends ServiceProvider {
  register(): void {}

  boot(): void {
    this.publishes({
      from: new URL(/* @vite-ignore */ '../pages', import.meta.url).pathname,
      to:   'pages/(panels)',
      tag:  'panels-lexical-pages',
    })
  }
}

/**
 * @deprecated Use `panelsLexical()` as a PanelPlugin with `Panel.use(panelsLexical())`.
 * Legacy factory for the `panels([...], [extensions])` pattern.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function panelsLexicalExtension(): new (...args: any[]) => PanelLexicalServiceProvider {
  return PanelLexicalServiceProvider
}

// ─── PanelPlugin factory ────────────────────────────────────

import type { PanelPlugin } from '@rudderjs/panels'

const pagesDir = new URL(/* @vite-ignore */ '../pages', import.meta.url).pathname

/**
 * Register Lexical rich-text editor as a panel plugin.
 *
 * @example
 * ```ts
 * import { panelsLexical } from '@rudderjs/panels-lexical/server'
 *
 * Panel.make('admin')
 *   .use(panelsLexical())
 * ```
 */
export function panelsLexical(): PanelPlugin {
  return {
    pages: pagesDir,
  }
}
