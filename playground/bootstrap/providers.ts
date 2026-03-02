import type { Application, ServiceProvider } from '@forge/core'
import { betterAuth } from '@forge/auth-better-auth'
import { queue } from '@forge/queue'
import { events } from '@forge/events'
import { mail } from '@forge/mail'
import { cache } from '@forge/cache'
import { scheduler } from '@forge/schedule'
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import { TodoServiceProvider } from '../app/Modules/Todo/TodoServiceProvider.js'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmailListener } from '../app/Listeners/SendWelcomeEmailListener.js'
import configs from '../config/index.js'

export default [
  DatabaseServiceProvider,  // must boot first — sets up ModelRegistry
  betterAuth(configs.auth),
  queue(configs.queue),
  events({ [UserRegistered.name]: [SendWelcomeEmailListener] }),
  mail(configs.mail),
  cache(configs.cache),
  scheduler(),
  AppServiceProvider,
  TodoServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
