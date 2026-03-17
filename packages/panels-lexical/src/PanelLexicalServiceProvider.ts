import { ServiceProvider } from '@boostkit/core'
import { registerLexical } from './register.js'

export class PanelLexicalServiceProvider extends ServiceProvider {
  register(): void {}

  boot(): void {
    registerLexical()

    this.publishes({
      from: new URL('../pages', import.meta.url).pathname,
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
export function panelsLexical(): new (...args: any[]) => PanelLexicalServiceProvider {
  return PanelLexicalServiceProvider
}
