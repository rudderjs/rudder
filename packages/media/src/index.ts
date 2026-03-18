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

// Server exports available via '@boostkit/media/server'
export { media, MediaServiceProvider } from './MediaServiceProvider.js'
