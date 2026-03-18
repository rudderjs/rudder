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
import { localization } from '@boostkit/localization'
import { database } from '@boostkit/orm-prisma'
import { panels } from '@boostkit/panels'
import { panelsLexical } from '@boostkit/panels-lexical/server'
import { broadcasting } from '@boostkit/broadcast'
import { live }   from '@boostkit/live'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmailListener } from '../app/Listeners/SendWelcomeEmailListener.js'
import configs from '../config/index.js'

export default [
  // ── Infrastructure (order matters) ──────────────────────
  database(configs.database), // boots first — binds PrismaClient to DI as 'prisma'
  auth(configs.auth),         // auto-discovers 'prisma' from DI
  session(configs.session),
  cache(configs.cache),

  // ── Features ────────────────────────────────────────────
  queue(configs.queue),
  events({ [UserRegistered.name]: [SendWelcomeEmailListener] }),
  mail(configs.mail),
  storage(configs.storage),
  localization(configs.localization),
  scheduler(),
  notifications(),
  broadcasting(),
  live(configs.live),         // /ws-live — Yjs CRDT sync (after broadcasting so upgrade handler chains correctly)

  // ── Admin panels ────────────────────────────────────────
  panels([adminPanel]),
  panelsLexical(),

  // ── Application ─────────────────────────────────────────
  // AppServiceProvider dynamically registers module providers
  // (e.g. TodoServiceProvider) via this.app.register()
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
