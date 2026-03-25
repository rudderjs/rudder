import type { Media, MediaElementMeta } from './schema/Media.js'

/**
 * SSR resolver for Media.make() schema element.
 * Always returns empty items — the MediaElement component fetches on mount (lazy).
 * Media browser is an interactive tool with no SEO/first-paint benefit from SSR.
 */
export async function resolveMedia(el: unknown): Promise<MediaElementMeta> {
  const media = el as Media
  return media.toMeta()
}
