'use client'

import { useState, useEffect } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { SchemaForm }  from '../../../../../_components/SchemaForm.js'
import type { SchemaFormMeta, PanelI18n } from '@rudderjs/panels'
import { useI18n } from '../../../../../_hooks/useI18n.js'
import { useAiChat } from '../../../../../_components/agents/AiChatContext.js'
import type { Data } from './+data.js'

export default function EditPage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, formElement, pathSegment, slug, id } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = useI18n() as PanelI18n & Record<string, string>
  config({ title: `${i18n.edit} ${resourceMeta.labelSingular} — ${panelName}` })

  const agents = resourceMeta.agents ?? []

  // AI chat — field updates + resource context + client tool calls
  let fieldUpdates: Array<{ field: string; value: string }> = []
  let setResourceContext: ((ctx: import('../../../../../_components/agents/AiChatContext.js').ResourceContext | null) => void) | null = null
  let setOnClientToolCall: ((fn: import('../../../../../_components/agents/AiChatContext.js').OnClientToolCall) => void) | null = null
  try {
    const aiChat = useAiChat()
    fieldUpdates = aiChat.fieldUpdates
    setResourceContext = aiChat.setResourceContext
    setOnClientToolCall = aiChat.setOnClientToolCall
  } catch { /* no provider */ }

  // Set resource context for AI chat when on edit page
  useEffect(() => {
    if (!setResourceContext || agents.length === 0) return
    setResourceContext({
      resourceSlug: slug,
      recordId: id,
      apiBase: `/${pathSegment}/api`,
      agents,
    })
    return () => setResourceContext!(null)
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
          setOnClientToolCall={setOnClientToolCall ?? undefined}
        />
      </div>
    </div>
  )
}
