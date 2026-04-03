import type { MediaConversion } from './types.js'

/** Configuration for a named media library. */
export interface MediaLibrary {
  disk:          string
  directory:     string
  accept?:       string[]
  maxUploadSize?: number
  conversions?:  MediaConversion[]
}

// globalThis-backed registry — survives Vite SSR module duplication
const KEY = '__rudderjs_media_libraries__'
const g = globalThis as Record<string, unknown>

function getMap(): Map<string, MediaLibrary> {
  if (!g[KEY]) g[KEY] = new Map<string, MediaLibrary>()
  return g[KEY] as Map<string, MediaLibrary>
}

/** Register a named media library. Called by media() plugin during boot. */
export function registerLibrary(name: string, config: MediaLibrary): void {
  getMap().set(name, config)
}

/** Get a named media library config. Returns undefined if not registered. */
export function getLibrary(name: string): MediaLibrary | undefined {
  return getMap().get(name)
}

/** Get the default library. Falls back to sensible defaults. */
export function getDefaultLibrary(): MediaLibrary {
  return getMap().get('default') ?? { disk: 'public', directory: 'media' }
}

/** Get all registered library names. */
export function getLibraryNames(): string[] {
  return [...getMap().keys()]
}
