import type { Server } from 'vike/types'
import app from './bootstrap/app.js'

export default {
  fetch: app.fetch,
} satisfies Server
