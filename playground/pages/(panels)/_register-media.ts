import { registerLazyElement, registerField } from '@boostkit/panels'

// Lazy-load Media schema element (SSR-safe via React.lazy)
registerLazyElement('media', () =>
  import('@boostkit/media').then(m => ({ default: (m as Record<string, unknown>).MediaElement as React.ComponentType }))
)

// Register MediaPickerField input component
import('@boostkit/media').then(m => {
  const { MediaPickerInput } = m as { MediaPickerInput: React.ComponentType }
  registerField('mediaPicker', MediaPickerInput)
}).catch(() => {})
