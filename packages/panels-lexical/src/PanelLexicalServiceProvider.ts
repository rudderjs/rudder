import { ServiceProvider } from '@boostkit/core'

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
 * Register @boostkit/panels-lexical as a service provider.
 *
 * Calls `registerLexical()` at boot to populate the editor registry,
 * and exposes `vendor:publish --tag=panels-lexical-pages` to copy the
 * Lexical UI components into your app's `pages/(panels)/` directory.
 *
 * @example
 * // bootstrap/providers.ts
 * import { panelsLexical } from '@boostkit/panels-lexical'
 * export default [
 *   panels([adminPanel]),
 *   panelsLexical(),
 * ]
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function panelsLexical(): new (...args: any[]) => PanelLexicalServiceProvider {
  return PanelLexicalServiceProvider
}
