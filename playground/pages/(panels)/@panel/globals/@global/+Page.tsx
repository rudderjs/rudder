'use client'

import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { toast } from 'sonner'
import { SchemaForm }  from '../../../_components/SchemaForm.js'
import type { SchemaFormMeta } from '@pilotiq/panels'
import { useI18n } from '../../../_hooks/useI18n.js'
import type { Data } from './+data.js'

export default function GlobalEditPage() {
  const config = useConfig()
  const { panelMeta, globalMeta, formElement, pathSegment, slug } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = useI18n()
  config({ title: `${globalMeta.label} — ${panelName}` })

  return (
    <div className="p-6">
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
    </div>
  )
}
