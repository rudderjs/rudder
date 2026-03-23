'use client'

import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { toast } from 'sonner'
import { Breadcrumbs } from '../../../_components/Breadcrumbs.js'
import { SchemaForm }  from '../../../_components/SchemaForm.js'
import type { SchemaFormMeta } from '@boostkit/panels'
import type { Data } from './+data.js'

export default function GlobalEditPage() {
  const config = useConfig()
  const { panelMeta, globalMeta, formElement, pathSegment, slug } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = panelMeta.i18n
  config({ title: `${globalMeta.label} — ${panelName}` })

  return (
    <>
      <Breadcrumbs crumbs={[
        { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}` },
        { label: globalMeta.label },
      ]} />

      <div className="max-w-2xl">
        <SchemaForm
          form={formElement as SchemaFormMeta}
          panelPath={`/${pathSegment}`}
          i18n={i18n}
          mode="edit"
          onSuccess={() => {
            toast.success((i18n as Record<string, string>).savedToast ?? 'Saved.')
            return undefined
          }}
        />
      </div>
    </>
  )
}
