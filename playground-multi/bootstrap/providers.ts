import type { Application, ServiceProvider } from '@rudderjs/core'
import { auth } from '@rudderjs/auth'
import { events } from '@rudderjs/core'
import { queue } from '@rudderjs/queue'
import { mail } from '@rudderjs/mail'
import { notifications } from '@rudderjs/notification'
import { cache } from '@rudderjs/cache'
import { storage } from '@rudderjs/storage'
import { scheduler } from '@rudderjs/schedule'
import { session } from '@rudderjs/session'
import { database } from '@rudderjs/orm-prisma'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import configs from '../config/index.js'

export default [
  database(configs.database),  // boots first — binds PrismaClient to DI as 'prisma'
  auth(configs.auth),                // auto-discovers 'prisma' from DI
  events({}),
  queue(configs.queue),
  mail(configs.mail),
  notifications(),
  cache(configs.cache),
  storage(configs.storage),
  session(configs.session),
  scheduler(),
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
