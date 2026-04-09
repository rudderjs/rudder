import { en }       from './en.js'
import { ar }       from './ar.js'
import type { PanelI18n } from './en.js'

export type { PanelI18n }

const translations: Record<string, PanelI18n> = { en, ar }

const RTL_LOCALES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug'])

// Cache merged i18n per locale to avoid re-merging on every call.
const mergedCache = new Map<string, PanelI18n>()

/**
 * Reference to `@rudderjs/localization`'s `LocalizationRegistry`, captured at
 * panel boot via `_setLocalizationRegistry()`. `@rudderjs/localization` is an
 * optional peer dep, so we can't import it statically — but `getOverride()`
 * is sync (called from the render path), so we can't dynamic-import per call
 * either. Capturing the typed registry once at boot gives us a sync, typed
 * read path with no `globalThis` reach-through.
 */
interface LocalizationRegistryLike {
  getCached(locale: string, namespace: string): Record<string, unknown> | undefined
}

let _localizationRegistry: LocalizationRegistryLike | null = null

/**
 * @internal — wires the localization registry for sync reads. Called by
 * `PanelServiceProvider.boot()` after dynamically importing the optional
 * peer, and by tests via `beforeEach`.
 */
export function _setLocalizationRegistry(registry: LocalizationRegistryLike | null): void {
  _localizationRegistry = registry
}

export function getPanelI18n(locale: string): PanelI18n {
  const cached = mergedCache.get(locale)
  if (cached) return cached

  const base = locale.split('-')[0] ?? locale

  // 1. Bundled default for this locale (or en fallback).
  const bundled = translations[locale] ?? translations[base] ?? en

  // 2. Optional app override loaded into the localization cache.
  const override = getOverride(locale) ?? getOverride(base)

  // 3. Override values win, bundled fills gaps.
  const merged = override ? deepMerge(bundled, override) : bundled

  mergedCache.set(locale, merged)
  return merged
}

/**
 * Read panel translations from `@rudderjs/localization`'s typed cache via
 * the `LocalizationRegistry` reference captured at boot. Returns undefined
 * if no override exists or localization isn't installed.
 *
 * Override files live at `lang/<locale>/pilotiq.json` (the `pilotiq` namespace).
 */
function getOverride(locale: string): Partial<PanelI18n> | undefined {
  if (!_localizationRegistry) return undefined
  const data = _localizationRegistry.getCached(locale, 'pilotiq') as Partial<PanelI18n> | undefined
  if (!data || Object.keys(data).length === 0) return undefined
  return data
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result: Record<string, unknown> = { ...target }
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    const existing = result[key]
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing !== null &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      result[key] = deepMerge(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      result[key] = value
    }
  }
  return result as T
}

export function getPanelDir(locale: string): 'ltr' | 'rtl' {
  const base = locale.split('-')[0] ?? locale
  return RTL_LOCALES.has(base) ? 'rtl' : 'ltr'
}

/** Get the current locale from globalThis (set by @rudderjs/localization) if available, else 'en'. */
export function getActiveLocale(): string {
  const g = globalThis as Record<string, unknown>
  const config = g['__rudderjs_localization_config__'] as { locale?: string } | undefined
  return config?.locale ?? 'en'
}

/** @internal — clears the merged cache. Used by tests and future HMR hooks. */
export function _clearI18nCache(): void {
  mergedCache.clear()
}
