'use client'

import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { toast } from 'sonner'
import { Breadcrumbs } from '../../../../_components/Breadcrumbs.js'
import { SchemaForm }  from '../../../../_components/SchemaForm.js'
import type { SchemaFormMeta } from '@boostkit/panels'
import { t } from '../../../../_lib/formHelpers.js'
import type { Data } from './+data.js'

export default function CreatePage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, formElement, pathSegment, slug, prefill, backHref } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = panelMeta.i18n
  config({ title: `${t(i18n.create, { singular: resourceMeta.labelSingular })} — ${panelName}` })

  return (
    <>
      <Breadcrumbs crumbs={[
        { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}/resources/${slug}` },
        { label: resourceMeta.label, href: `/${pathSegment}/resources/${slug}` },
        { label: t(i18n.create, { singular: resourceMeta.labelSingular }) },
      ]} />

      <div className="max-w-2xl">
        <SchemaForm
          form={formElement as SchemaFormMeta}
          panelPath={`/${pathSegment}`}
          i18n={i18n}
          mode="create"
          prefill={Object.keys(prefill).length > 0 ? prefill : undefined}
          cancelUrl={backHref}
          submitUrl={`/${pathSegment}/api/${slug}`}
          submitMethod="POST"
          onSuccess={() => {
            toast.success(t(i18n.createdToast, { singular: resourceMeta.labelSingular }))
            return backHref
          }}
        />
      </div>
    </>
  )
}
