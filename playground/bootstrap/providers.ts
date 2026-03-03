import type { Application, ServiceProvider } from '@forge/core'
import { betterAuth } from '@forge/auth-better-auth'
import { queue } from '@forge/queue'
import { events } from '@forge/events'
import { mail } from '@forge/mail'
import { cache } from '@forge/cache'
import { storage } from '@forge/storage'
import { scheduler } from '@forge/schedule'
import { notifications } from '@forge/notification'
import { DatabaseServiceProvider } from '../app/Providers/DatabaseServiceProvider.js'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import { TodoServiceProvider } from '../app/Modules/Todo/TodoServiceProvider.js'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmailListener } from '../app/Listeners/SendWelcomeEmailListener.js'
import configs from '../config/index.js'

export default [
  betterAuth(configs.auth),
  queue(configs.queue),
  events({ [UserRegistered.name]: [SendWelcomeEmailListener] }),
  mail(configs.mail),
  cache(configs.cache),
  storage(configs.storage),
  scheduler(),
  notifications(),
  DatabaseServiceProvider,  // must boot before AppServiceProvider — sets ModelRegistry
  AppServiceProvider,
  TodoServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
