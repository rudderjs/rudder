'use client'

import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { useI18n } from '../../_hooks/useI18n.js'
import { SchemaPageContent } from '../../_components/SchemaPageContent.js'
import type { SchemaElement, I18nExtended } from '../../_components/schema-types.js'
import type { Data } from './+data.js'

export default function SchemaPage() {
  const config = useConfig()
  const { panelMeta, pageMeta, schemaData, pathSegment, urlSearch } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = useI18n() as I18nExtended
  config({ title: `${pageMeta.label} — ${panelName}` })

  if (!schemaData || schemaData.length === 0) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">No content defined for this page.</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex flex-col gap-6">
        <SchemaPageContent
          key={pageMeta.slug}
          elements={schemaData as SchemaElement[]}
          panelPath={panelMeta.path}
          pathSegment={pathSegment}
          i18n={i18n}
          urlSearch={urlSearch}
        />
      </div>
    </div>
  )
}
