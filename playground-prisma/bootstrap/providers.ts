import type { Application, ServiceProvider } from '@rudderjs/core'
import { defaultProviders, eventsProvider } from '@rudderjs/core'
import { AppServiceProvider } from 'App/Providers/AppServiceProvider.js'
import { UserRegistered } from 'App/Events/UserRegistered.js'
import { SendWelcomeEmailListener } from 'App/Listeners/SendWelcomeEmailListener.js'

export default [
  ...(await defaultProviders()),
  eventsProvider({ [UserRegistered.name]: [SendWelcomeEmailListener] }),
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
