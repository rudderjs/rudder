import type { Server } from 'vike/types'
import app from './bootstrap/app.js'

// Same integration as playground/ and playground-web/: the Vike server entry
// hands every request to the RudderJS server-hono fetch handler, which mounts
// Vike's SSR catch-all internally. For RSC, Vike's renderPageServer dispatches
// the `/_rsc` config middleware itself — no extra mount needed (see the RSC
// integration design doc, Phase 3).
export default {
  fetch: app.fetch,
} satisfies Server
