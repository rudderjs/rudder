import { resolve } from 'node:path'
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
import { ai }        from '@rudderjs/ai'
import { panels } from '@pilotiq/panels'
import { AiServiceProvider } from '@pilotiq-pro/ai'
import { CollabServiceProvider } from '@pilotiq-pro/collab'
import { adminPanel } from '../app/Panels/Admin/AdminPanel.js'
import { boost }     from '@rudderjs/boost'
import { log }       from '@rudderjs/log'
import { telescope } from '@rudderjs/telescope'
import { pulse }     from '@rudderjs/pulse'
import { horizon }   from '@rudderjs/horizon'
import { AppServiceProvider } from '../app/Providers/AppServiceProvider.js'
import { UserRegistered } from '../app/Events/UserRegistered.js'
import { SendWelcomeEmailListener } from '../app/Listeners/SendWelcomeEmailListener.js'
import configs from '../config/index.js'

export default [
  // ── Infrastructure (order matters) ──────────────────────
  log(configs.log),           // boots first — available to all other providers
  database(configs.database), // binds PrismaClient to DI as 'prisma'
  session(configs.session),
  hash(configs.hash),
  cache(configs.cache),
  auth(configs.auth),         // requires session + hash

  // ── Features ────────────────────────────────────────────
  queue(configs.queue),
  events({ [UserRegistered.name]: [SendWelcomeEmailListener] }),
  mail(configs.mail),
  storage(configs.storage),
  localization({
    locale:   configs.app.locale,
    fallback: configs.app.fallback,
    path:     resolve(process.cwd(), 'lang'),
  }),
  scheduler(),
  notifications(),
  broadcasting(),
  live(configs.live),
  ai(configs.ai),
  boost(),

  // ── Monitoring ──────────────────────────────────────────
  telescope(configs.telescope),
  pulse(configs.pulse),
  horizon(configs.horizon),

  // ── Panels (open-core) + AI runtime (commercial) ────────
  // Order matters here:
  // 1. `AiServiceProvider.register()` seeds `BuiltInAiActionRegistry` so
  //    `Field.ai(['rewrite'])` resolves at form-build time during the
  //    panels factory's boot().
  // 2. `panels(...)` registers the panel and (in boot()) iterates resources
  //    to mount routes — Field.ai succeeds because the catalogue is seeded.
  // 3. After both register() phases run, boot() runs in registration order:
  //    AiServiceProvider.boot() iterates the now-populated PanelRegistry to
  //    mount chat + standalone agent routes; panels.boot() mounts CRUD.
  //    Both prerequisites are in place. See pilotiq/docs/plans/
  //    phase-4-ai-extraction.md §4.6 R3 for the boot-order rationale.
  AiServiceProvider,
  // CollabServiceProvider seeds CollabSupportRegistry with ['websocket',
  // 'indexeddb'] so `Field.persist(['websocket'])` validation succeeds during
  // panels factory boot. Must register before panels([adminPanel]) — same
  // boot-order rule as AiServiceProvider. Phase 5 (2026-04-10).
  CollabServiceProvider,
  panels([adminPanel]),

  // ── Application ─────────────────────────────────────────
  AppServiceProvider,
] satisfies (new (app: Application) => ServiceProvider)[]
