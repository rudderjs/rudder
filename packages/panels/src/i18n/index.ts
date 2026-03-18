import { en }       from './en.js'
import { ar }       from './ar.js'
import type { PanelI18n } from './en.js'

export type { PanelI18n }

const translations: Record<string, PanelI18n> = { en, ar }

const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug'])

export function getPanelI18n(locale: string): PanelI18n {
  const base = locale.split('-')[0] ?? locale
  return translations[locale] ?? translations[base] ?? en
}

export function getPanelDir(locale: string): 'ltr' | 'rtl' {
  const base = locale.split('-')[0] ?? locale
  return RTL_LOCALES.has(base) ? 'rtl' : 'ltr'
}

/** Get the current locale from globalThis (set by @boostkit/localization) if available, else 'en'. */
export function getActiveLocale(): string {
  const g = globalThis as Record<string, unknown>
  const config = g['__boostkit_localization_config__'] as { locale?: string } | undefined
  return config?.locale ?? 'en'
}
