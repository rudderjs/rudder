import type { Application, ServiceProvider } from '@boostkit/core'
import { events } from '@boostkit/core'
import { auth } from '@boostkit/auth'
import { queue } from '@boostkit/queue'
import { mail } from '@boostkit/mail'
import { cache } from '@boostkit/cache'
import { storage } from '@boostkit/storage'
import { scheduler } from '@boostkit/schedule'
import { notifications } from '@boostkit/notification'
import { session } from '@boostkit/session'
import { database } from '@boostkit/orm-prisma'
import { panels } from '@boostkit/panels'
import { ws }     from '@boostkit/ws'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import { TodoServiceProvider } from '../app/Modules/Todo/TodoServiceProvider.js'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmailListener } from '../app/Listeners/SendWelcomeEmailListener.js'
import configs from '../config/index.js'

export default [
  database(configs.database), // boots first — binds PrismaClient to DI as 'prisma'
  auth(configs.auth),       // auto-discovers 'prisma' from DI
  queue(configs.queue),
  events({ [UserRegistered.name]: [SendWelcomeEmailListener] }),
  mail(configs.mail),
  cache(configs.cache),
  storage(configs.storage),
  session(configs.session),
  scheduler(),
  notifications(),
  panels([adminPanel]),
  ws(),
  AppServiceProvider,
  TodoServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
