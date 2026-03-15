import { editorRegistry } from '@boostkit/panels'
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
  editorRegistry.richcontent = LexicalEditor as any
  editorRegistry.collaborativePlainText = CollaborativePlainText as any
}
