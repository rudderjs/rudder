import { registerLazyElement } from '@boostkit/panels'

registerLazyElement('media', () =>
  import('@boostkit/media').then(m => ({ default: (m as Record<string, unknown>).MediaElement as React.ComponentType }))
)
