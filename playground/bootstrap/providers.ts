import type { ServiceProvider } from '@forge/core'
import type { Application } from '@forge/core'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'

/**
 * All service providers registered with the application.
 * `forge make:module` appends providers here automatically.
 */
export const providers: (new (app: Application) => ServiceProvider)[] = [
  AppServiceProvider,
]
