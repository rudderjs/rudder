import type { Application, ServiceProvider } from '@rudderjs/core'
import { events } from '@rudderjs/core'
import { auth } from '@rudderjs/auth'
import { hash } from '@rudderjs/hash'
import { queue } from '@rudderjs/queue'
import { mail } from '@rudderjs/mail'
import { cache } from '@rudderjs/cache'
import { storage } from '@rudderjs/storage'
import { scheduler } from '@rudderjs/schedule'
import { notifications } from '@rudderjs/notification'
import { session } from '@rudderjs/session'
import { localization } from '@rudderjs/localization'
import { database } from '@rudderjs/orm-prisma'
import { broadcasting } from '@rudderjs/broadcast'
import { live }   from '@rudderjs/live'
import { ai }     from '@rudderjs/ai'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmailListener } from '../app/Listeners/SendWelcomeEmailListener.js'
import configs from '../config/index.js'

export default [
  // ── Infrastructure (order matters) ──────────────────────
  database(configs.database), // boots first — binds PrismaClient to DI as 'prisma'
  session(configs.session),
  hash(configs.hash),
  cache(configs.cache),
  auth(configs.auth),         // requires session + hash

  // ── Features ────────────────────────────────────────────
  queue(configs.queue),
  events({ [UserRegistered.name]: [SendWelcomeEmailListener] }),
  mail(configs.mail),
  storage(configs.storage),
  localization(configs.localization),
  scheduler(),
  notifications(),
  broadcasting(),
  live(configs.live),
  ai(configs.ai),

  // ── Application ─────────────────────────────────────────
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
