'use client'

import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { toast } from 'sonner'
import { SchemaForm }  from '../../../../_components/SchemaForm.js'
import type { SchemaFormMeta } from '@rudderjs/panels'
import { useI18n } from '../../../../_hooks/useI18n.js'
import { t } from '../../../../_lib/formHelpers.js'
import type { Data } from './+data.js'

export default function CreatePage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, formElement, pathSegment, slug, prefill, backHref } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = useI18n()
  config({ title: `${t(i18n.create, { singular: resourceMeta.labelSingular })} — ${panelName}` })

  return (
    <div className="p-6">
      <div className="max-w-2xl">
        <SchemaForm
          form={formElement as SchemaFormMeta}
          panelPath={`/${pathSegment}`}
          i18n={i18n}
          mode="create"
          prefill={prefill && Object.keys(prefill).length > 0 ? prefill : undefined}
          cancelUrl={backHref ?? `/${pathSegment}/resources/${slug}`}
          submitUrl={`/${pathSegment}/api/${slug}`}
          submitMethod="POST"
          onSuccess={() => {
            toast.success(t(i18n.createdToast, { singular: resourceMeta.labelSingular }))
            return backHref ?? `/${pathSegment}/resources/${slug}`
          }}
        />
      </div>
    </div>
  )
}
