import { registerField } from '@rudderjs/panels'
import { LexicalEditor } from './LexicalEditor.js'
import { CollaborativePlainText } from './CollaborativePlainText.js'

/**
 * Register Lexical editor components with @rudderjs/panels.
 *
 * Call once in your app's client-side entry point:
 *
 * ```ts
 * import { registerLexical } from '@rudderjs/panels-lexical'
 * registerLexical()
 * ```
 */
export function registerLexical(): void {
  registerField('_lexical:richcontent', LexicalEditor)
  registerField('_lexical:collaborativePlainText', CollaborativePlainText)
}
