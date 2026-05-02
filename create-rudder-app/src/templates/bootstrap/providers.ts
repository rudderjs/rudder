import type { TemplateContext } from '../../templates.js'

export function bootstrapProviders(ctx: TemplateContext): string {
  const imports: string[] = [
    "import type { Application, ServiceProvider } from '@rudderjs/core'",
    "import { defaultProviders, eventsProvider } from '@rudderjs/core'",
    "import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'",
  ]

  const providers: string[] = [
    '...(await defaultProviders()),',
    'eventsProvider({}),',
    'AppServiceProvider,',
  ]

  return `${imports.join('\n')}

// All framework providers are auto-discovered from package.json metadata.
// Run \`pnpm rudder providers:discover\` after installing or removing packages.
//
// To skip a specific framework provider:
//   ...(await defaultProviders({ skip: ['@rudderjs/horizon'] })),
//
// To turn off auto-discovery entirely, replace \`...(await defaultProviders())\`
// with explicit class imports — see the framework docs.
export default [
  ${providers.join('\n  ')}
] satisfies (new (app: Application) => ServiceProvider)[]
`
}
