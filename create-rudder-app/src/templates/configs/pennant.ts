export function configPennant(): string {
  return `import type { PennantConfig } from '@rudderjs/pennant'

// Feature flags via @rudderjs/pennant. Define features in
// app/Providers/AppServiceProvider.ts using \`Pennant.feature(...)\`,
// then check with \`Feature.active('beta-search', user)\`.
//
// Currently ships with a memory driver — feature state is not persisted
// across restarts. Custom drivers can be added by implementing the
// PennantDriver interface and registering at boot.
export default {
  driver: 'memory',
} satisfies PennantConfig
`
}
