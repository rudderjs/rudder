import type { Application, ServiceProvider } from '@boostkit/core'
import { betterAuth } from '@boostkit/auth'
import { queue } from '@boostkit/queue'
import { events } from '@boostkit/events'
import { mail } from '@boostkit/mail'
import { cache } from '@boostkit/cache'
import { storage } from '@boostkit/storage'
import { scheduler } from '@boostkit/schedule'
import { notifications } from '@boostkit/notification'
import { session } from '@boostkit/session'
import { prismaProvider } from '@boostkit/orm-prisma'
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
  session(configs.session),
  scheduler(),
  notifications(),
  prismaProvider(configs.database),  // must boot before AppServiceProvider — sets ModelRegistry
  AppServiceProvider,
  TodoServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
