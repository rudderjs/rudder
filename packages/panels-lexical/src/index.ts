import { ServiceProvider } from '@boostkit/core'

/**
 * Lexical rich-text editor adapter for @boostkit/panels.
 *
 * Publishes LexicalEditor and CollaborativePlainText components into the
 * panels UI pages. These render `richcontent` fields and collaborative
 * `text`/`textarea`/`email` fields using Lexical + Yjs.
 *
 * @example
 * ```ts
 * // bootstrap/providers.ts
 * import { panelsLexical } from '@boostkit/panels-lexical'
 *
 * export default [
 *   panels([adminPanel]),
 *   panelsLexical(),
 *   // ...
 * ]
 * ```
 */
class PanelsLexicalServiceProvider extends ServiceProvider {
  register(): void {}

  async boot(): Promise<void> {
    this.publishes({
      from: new URL('../pages', import.meta.url).pathname,
      to:   'pages/(panels)',
      tag:  'panels-lexical',
    })
  }
}

/** Factory function — register in providers to publish Lexical editor components. */
export function panelsLexical(): PanelsLexicalServiceProvider {
  return new PanelsLexicalServiceProvider()
}
