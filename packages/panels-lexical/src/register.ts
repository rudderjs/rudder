import { registerField } from '@boostkit/panels'
import { LexicalEditor } from './LexicalEditor.js'
import { CollaborativePlainText } from './CollaborativePlainText.js'

/**
 * Register Lexical editor components with @boostkit/panels.
 *
 * Call once in your app's client-side entry point:
 *
 * ```ts
 * import { registerLexical } from '@boostkit/panels-lexical'
 * registerLexical()
 * ```
 */
export function registerLexical(): void {
  registerField('richcontent', LexicalEditor)
  registerField('collaborativePlainText', CollaborativePlainText)
}
