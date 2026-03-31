import { registerLazyElement, registerField } from '@boostkit/panels'

// Register Canvas schema element (lazy-loaded, SSR-safe)
registerLazyElement('canvas', () =>
  import('./_components/canvas/WorkspaceCanvas.js').then(m => ({
    default: (m as Record<string, unknown>).WorkspaceCanvas as React.ComponentType,
  }))
)

// Register CanvasField input component
registerField('canvas', () =>
  import('./_components/canvas/WorkspaceCanvas.js').then(m => ({
    default: (m as Record<string, unknown>).WorkspaceCanvas as React.ComponentType,
  }))
)
