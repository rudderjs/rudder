'use client'

import { useState, useEffect } from 'react'
import { useData }   from 'vike-react/useData'
import { useConfig } from 'vike-react/useConfig'
import { SchemaForm }  from '../../../../../_components/SchemaForm.js'
import type { SchemaFormMeta, PanelI18n } from '@boostkit/panels'
import { useI18n } from '../../../../../_hooks/useI18n.js'
import { AgentSidebar } from '../../../../../_components/agents/AgentSidebar.js'
import { AgentToolbar } from '../../../../../_components/agents/AgentToolbar.js'
import type { Data } from './+data.js'

export default function EditPage() {
  const config = useConfig()
  const { panelMeta, resourceMeta, formElement, pathSegment, slug, id } = useData<Data>()
  const panelName = panelMeta.branding?.title ?? panelMeta.name
  const i18n = useI18n() as PanelI18n & Record<string, string>
  config({ title: `${i18n.edit} ${resourceMeta.labelSingular} — ${panelName}` })

  const agents = resourceMeta.agents ?? []
  const hasAgents = agents.length > 0
  const [agentSidebarOpen, setAgentSidebarOpen] = useState(false)

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
    <div className="flex h-full">
      <div className="flex-1 p-6 overflow-y-auto">
        {hasAgents && (
          <div className="max-w-2xl mb-2 flex justify-end">
            <AgentToolbar
              hasAgents={hasAgents}
              open={agentSidebarOpen}
              onToggle={() => setAgentSidebarOpen(v => !v)}
            />
          </div>
        )}
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

      {hasAgents && (
        <AgentSidebar
          agents={agents}
          recordId={id}
          resourceSlug={slug}
          apiBase={`/${pathSegment}/api`}
          open={agentSidebarOpen}
          onClose={() => setAgentSidebarOpen(false)}
        />
      )}
    </div>
  )
}
