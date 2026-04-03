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

// Field type
export { MediaPickerField } from './schema/MediaPickerField.js'

// Library registry (used by Media.make().library() and MediaPickerField)
export { getLibrary, getDefaultLibrary, getLibraryNames } from './registry.js'
export type { MediaLibrary } from './registry.js'

// Client components
export { MediaElement } from './components/MediaElement.js'
export { MediaPickerInput } from './components/MediaPickerInput.js'

// Server exports available via '@rudderjs/media/server'
export { media, MediaServiceProvider } from './MediaServiceProvider.js'
