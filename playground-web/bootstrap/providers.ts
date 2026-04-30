import type { Application, ServiceProvider } from '@rudderjs/core'
import { defaultProviders, eventsProvider } from '@rudderjs/core'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmailListener } from '../app/Listeners/SendWelcomeEmailListener.js'

export default [
  ...(await defaultProviders()),
  eventsProvider({ [UserRegistered.name]: [SendWelcomeEmailListener] }),
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
