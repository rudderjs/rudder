import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import { hono } from '@rudderjs/server-hono'
import configs from '../config/index.ts'
import providers from './providers.ts'

// Minimal RudderJS app for the React Server Components demo. No auth/ORM/cache —
// just routing + view() rendering through Vike + vike-react-rsc.
export default Application.configure({
  server:    hono(configs.server),
  config:    configs,
  providers,
})
  .withRouting({
    web: () => import('../routes/web.ts'),
  })
  .create()
