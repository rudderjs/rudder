'use client'

import { createContext, useContext } from 'react'
import type { PanelI18n } from '@rudderjs/panels'
import { getPanelI18n } from '@rudderjs/panels'

const I18nContext = createContext<PanelI18n>(getPanelI18n('en'))

interface I18nProviderProps {
  /** Pre-merged i18n from `panelMeta.i18n` (serialized from the server). Preferred — preserves any `lang/<locale>/panels.json` overrides on the client. */
  i18n?:    PanelI18n
  /** Fallback when `i18n` isn't provided. Recomputes from bundled defaults only — overrides will not apply on the client. */
  locale?:  string
  children: React.ReactNode
}

export function I18nProvider({ i18n, locale, children }: I18nProviderProps) {
  const value = i18n ?? getPanelI18n(locale ?? 'en')
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): PanelI18n {
  return useContext(I18nContext)
}
