import type { Application, ServiceProvider } from '@rudderjs/core'
import { defaultProviders } from '@rudderjs/core'

// Framework providers are auto-discovered from installed package.json metadata.
// Run `pnpm rudder providers:discover` after installing or removing packages.
export default [
  ...(await defaultProviders()),
] satisfies (new (app: Application) => ServiceProvider)[]
