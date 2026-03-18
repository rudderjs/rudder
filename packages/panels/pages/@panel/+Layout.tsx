'use client'

import type { ReactNode } from 'react'
import { usePageContext } from 'vike-react/usePageContext'
import { AdminLayout }    from '../_components/AdminLayout.js'
import type { PanelMeta } from '@boostkit/panels'
import { registerLexical } from '@boostkit/panels-lexical'

registerLexical()

export default function PanelLayout({ children }: { children: ReactNode }) {
   
  const { data } = usePageContext() as { data: { panelMeta: PanelMeta; slug?: string; sessionUser?: { name?: string; email?: string; image?: string } } }
  return (
    <AdminLayout panelMeta={data.panelMeta} currentSlug={data.slug ?? ''} {...(data.sessionUser !== undefined ? { initialUser: data.sessionUser } : {})}>
      {children}
    </AdminLayout>
  )
}
