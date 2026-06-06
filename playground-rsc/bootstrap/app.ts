import 'reflect-metadata'
import 'dotenv/config'
import { Application } from '@rudderjs/core'
import config from '../config/index.ts'
import providers from './providers.ts'

// Minimal RudderJS app for the React Server Components demo. No auth/ORM/cache —
// just routing + view() rendering through Vike + vike-react-rsc-rudder.
export default Application.configure({ config, providers })
  .withRouting({
    web: () => import('../routes/web.ts'),
  })
  .create()
