import { registerElement } from '@boostkit/panels'
import { MediaElement } from './components/MediaElement.js'

/**
 * Register the Media schema element renderer with @boostkit/panels.
 *
 * Call once in your app's client-side entry point, or it's auto-registered
 * by the panels +Layout.tsx dynamic import.
 *
 * ```ts
 * import { registerMedia } from '@boostkit/media'
 * registerMedia()
 * ```
 */
export function registerMedia(): void {
  registerElement('media', MediaElement)
}
