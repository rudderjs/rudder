'use client'

import { useState, useEffect } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { Breadcrumbs } from '../../../../../_components/Breadcrumbs.js'
import { SchemaForm }  from '../../../../../_components/SchemaForm.js'
import type { SchemaFormMeta } from '@boostkit/panels'
import type { Data } from './+data.js'

export default function EditPage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, formElement, pathSegment, slug, id, record } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = panelMeta.i18n as Data['panelMeta']['i18n'] & Record<string, string>
  config({ title: `${i18n.edit} ${resourceMeta.labelSingular} — ${panelName}` })

  // Back navigation
  const defaultBack = `/${pathSegment}/resources/${slug}`
  const [backHref, setBackHref] = useState(defaultBack)
  useEffect(() => {
    const fromQs = new URLSearchParams(window.location.search).get('back')
    if (fromQs) setBackHref(fromQs)
  }, [])

  if (!record) {
    return <p className="text-muted-foreground">{i18n.recordNotFound}</p>
  }

  return (
    <div className="p-6">
      <Breadcrumbs crumbs={[
        { label: panelMeta.branding?.title ?? panelMeta.name, href: `/${pathSegment}/resources/${slug}` },
        { label: resourceMeta.label, href: `/${pathSegment}/resources/${slug}` },
        { label: `${i18n.edit} ${resourceMeta.labelSingular}` },
      ]} />

      <div className="max-w-2xl">
        <SchemaForm
          form={formElement as SchemaFormMeta}
          panelPath={`/${pathSegment}`}
          i18n={i18n}
          mode="edit"
          recordId={id}
          resourceSlug={slug}
          backUrl={backHref}
        />
      </div>
    </div>
  )
}
