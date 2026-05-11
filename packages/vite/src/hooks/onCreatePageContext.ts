import type { PageContext } from 'vike/types'
import { runPageContextEnhancers } from '../page-context-enhancers.js'

/**
 * Vike `+onCreatePageContext` hook — runs after routing on every page render.
 *
 * Wired via `@rudderjs/vite/config` (the user's `pages/+config.ts` extends it).
 */
export async function onCreatePageContext(pageContext: PageContext): Promise<void> {
  await runPageContextEnhancers(pageContext)
}
