import { resolve } from 'node:path'
import { Env } from '@boostkit/core'

export default {
  locale: Env.get('APP_LOCALE', 'en'),
  fallback: 'en',
  path: resolve(import.meta.dirname, '../lang'),
}
