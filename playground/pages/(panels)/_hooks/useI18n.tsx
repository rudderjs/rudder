'use client'

import { createContext, useContext } from 'react'
import type { PanelI18n } from '@rudderjs/panels'
import { getPanelI18n } from '@rudderjs/panels'

const I18nContext = createContext<PanelI18n>(getPanelI18n('en'))

export function I18nProvider({ locale, children }: { locale: string; children: React.ReactNode }) {
  const i18n = getPanelI18n(locale)
  return <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>
}

export function useI18n(): PanelI18n {
  return useContext(I18nContext)
}
