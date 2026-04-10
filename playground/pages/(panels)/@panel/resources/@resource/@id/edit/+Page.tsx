'use client'

import { useState, useEffect } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { SchemaForm }  from '../../../../../_components/SchemaForm.js'
import type { SchemaFormMeta, PanelI18n, PanelAgentMeta } from '@pilotiq/panels'
import { useAiUi } from '@pilotiq/panels'
import { useI18n } from '../../../../../_hooks/useI18n.js'
import type { Data } from './+data.js'

/**
 * Shape of the resource context that `@pilotiq-pro/ai`'s chat expects when
 * driving the edit page. Defined locally so free doesn't depend on the pro
 * type surface — pro's own `useAiChat` return narrows to this superset.
 */
interface ResourceContext {
  resourceSlug: string
  recordId:     string
  apiBase:      string
  agents:       PanelAgentMeta[]
}

export default function EditPage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, formElement, pathSegment, slug, id } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = useI18n() as PanelI18n & Record<string, string>
  config({ title: `${i18n.edit} ${resourceMeta.labelSingular} — ${panelName}` })

  const agents = resourceMeta.agents ?? []

  // AI chat surfaces come from the open-core slot bag. When
  // `@pilotiq-pro/ai` is installed it contributes a `useAiChat` hook that
  // exposes field-update animations + a `setResourceContext` setter so the
  // chat assistant knows which record is active. Without pro: both are
  // undefined and the edit page loses the animation + context plumbing,
  // but the form itself still renders and saves normally.
  //
  // Conditional hook call is stable per mount — see the AiUiContext
  // rationale in TextInput.tsx / @panel/+Layout.tsx.
  const { useAiChat } = useAiUi()
  const aiChat = useAiChat ? (useAiChat() as {
    fieldUpdates?:       Array<{ field: string; value: string }>
    setResourceContext?: (ctx: ResourceContext | null) => void
  }) : null
  const fieldUpdates       = aiChat?.fieldUpdates ?? []
  const setResourceContext = aiChat?.setResourceContext ?? null

  // Set resource context for AI chat when on edit page
  useEffect(() => {
    if (!setResourceContext || agents.length === 0) return
    setResourceContext({
      resourceSlug: slug,
      recordId:     id,
      apiBase:      `/${pathSegment}/api`,
      agents,
    })
    return () => setResourceContext(null)
  }, [slug, id, pathSegment, agents.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Back navigation
  const defaultBack = `/${pathSegment}/resources/${slug}`
  const [backHref, setBackHref] = useState(defaultBack)
  useEffect(() => {
    const fromQs = new URLSearchParams(window.location.search).get('back')
    if (fromQs) setBackHref(fromQs)
  }, [])

  if (!(formElement as Record<string, unknown>)?.initialValues) {
    return <p className="text-muted-foreground">{i18n.recordNotFound}</p>
  }

  return (
    <div className="p-6">
      <div className="max-w-2xl">
        <SchemaForm
          form={formElement as SchemaFormMeta}
          panelPath={`/${pathSegment}`}
          i18n={i18n}
          mode="edit"
          recordId={id}
          resourceSlug={slug}
          backUrl={backHref}
          agentFieldUpdates={fieldUpdates}
          agents={agents}
        />
      </div>
    </div>
  )
}
