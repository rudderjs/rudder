import { resolve } from 'node:path'
import { Env } from '@rudderjs/core'

export default {
  locale: Env.get('APP_LOCALE', 'ar'),
  fallback: 'en',
  path: resolve(import.meta.dirname, '../lang'),
}
