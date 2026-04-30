import { resolve } from 'node:path'
import { Env } from '@rudderjs/core'
import type { LocalizationConfig } from '@rudderjs/localization'

export default {
  locale:   Env.get('APP_LOCALE',          'en'),
  fallback: Env.get('APP_FALLBACK_LOCALE', 'en'),
  path:     resolve(process.cwd(), 'lang'),
} satisfies LocalizationConfig
