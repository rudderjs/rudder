'use client'

import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { useI18n } from '../_hooks/useI18n.js'
import { SchemaPageContent } from '../_components/SchemaPageContent.js'
import type { SchemaElement, I18nExtended } from '../_components/schema-types.js'
import type { Data } from './+data.js'

export default function PanelRootPage() {
  const config = useConfig()
  const { panelMeta, schemaData, urlSearch } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  config({ title: panelName })

  const i18n = useI18n() as I18nExtended
  const pathSegment = panelMeta.path.replace(/^\//, '')

  if (!schemaData || schemaData.length === 0) return null

  return (
    <div className="flex flex-col gap-6 p-6">
      <SchemaPageContent
        elements={schemaData as SchemaElement[]}
        panelPath={panelMeta.path}
        pathSegment={pathSegment}
        i18n={i18n}
        urlSearch={urlSearch}
      />
    </div>
  )
}
