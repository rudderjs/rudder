import type { Application, ServiceProvider } from '@boostkit/core'
import { auth } from '@boostkit/auth'
import { events } from '@boostkit/core'
import { queue } from '@boostkit/queue'
import { mail } from '@boostkit/mail'
import { notifications } from '@boostkit/notification'
import { cache } from '@boostkit/cache'
import { storage } from '@boostkit/storage'
import { scheduler } from '@boostkit/schedule'
import { session } from '@boostkit/session'
import { database } from '@boostkit/orm-prisma'
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
