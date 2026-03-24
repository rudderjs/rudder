import { registerLazyElement } from '@boostkit/panels'

/**
 * Register the Media schema element renderer with @boostkit/panels.
 *
 * Uses React.lazy for SSR-compatible code-splitting.
 * Call once at module load time (e.g. top-level in +Layout or +config).
 *
 * ```ts
 * import { registerMedia } from '@boostkit/media'
 * registerMedia()
 * ```
 */
export function registerMedia(): void {
  registerLazyElement('media', () =>
    import('./components/MediaElement.js').then(m => ({ default: m.MediaElement }))
  )
}
