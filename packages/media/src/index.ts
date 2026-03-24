// Public API — types + utilities usable in both server and client contexts.

export type {
  MediaRecord,
  ConversionInfo,
  MediaConversion,
  MediaConfig,
  MediaPageData,
  FileCategory,
} from './types.js'

export { categorize } from './types.js'

// Schema element
export { Media } from './schema/Media.js'
export type { MediaElementMeta } from './schema/Media.js'

// Client registration
export { registerMedia } from './register.js'

// Server exports available via '@boostkit/media/server'
export { media, MediaServiceProvider } from './MediaServiceProvider.js'
