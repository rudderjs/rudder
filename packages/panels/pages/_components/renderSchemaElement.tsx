'use client'

import { SchemaElementRenderer } from './SchemaElementRenderer.js'
import { StandaloneWidget } from './StandaloneWidget.js'
import { SchemaForm } from './SchemaForm.js'
import { SchemaDialog } from './SchemaDialog.js'
import { SchemaTabs } from './SchemaTabs.js'
import { SchemaSection } from './SchemaSection.js'
import type { PanelSchemaElementMeta, FormElementMeta, DialogElementMeta } from '@rudderjs/panels'
import type { WidgetWithSchema } from './WidgetCard.js'
import type { SchemaElement, TabItem, DashboardEl, I18nExtended } from './schema-types.js'
import type { SchemaSectionProps } from './SchemaSection.js'

export interface RenderContext {
  panelPath: string
  pathSegment: string
  i18n: I18nExtended
  urlSearch?: Record<string, string>
  renderDashboard?: (el: DashboardEl, idx: number) => React.ReactNode
}

/**
 * Render a single schema element by type. Shared by SchemaTabs, SchemaSection, and SchemaPageContent
 * to avoid duplicating the element-type switching logic.
 */
export function renderSchemaElement(
  el: SchemaElement,
  index: number,
  ctx: RenderContext,
  keyPrefix = '',
): React.ReactNode {
  const key = keyPrefix ? `${keyPrefix}-${index}` : `${index}`

  if (el.type === 'widget') {
    return (
      <StandaloneWidget
        key={`${key}-w`}
        widget={el as unknown as WidgetWithSchema}
        panelPath={ctx.panelPath}
        pathSegment={ctx.pathSegment}
        i18n={ctx.i18n}
      />
    )
  }

  if (el.type === 'form') {
    return (
      <SchemaForm
        key={`${key}-f`}
        form={el as FormElementMeta}
        panelPath={ctx.panelPath}
        i18n={ctx.i18n}
      />
    )
  }

  if (el.type === 'dialog') {
    return (
      <SchemaDialog
        key={`${key}-d`}
        dialog={el as DialogElementMeta}
        panelPath={ctx.panelPath}
        pathSegment={ctx.pathSegment}
        i18n={ctx.i18n}
      />
    )
  }

  if (el.type === 'tabs') {
    const tabsEl = el as { type: 'tabs'; id?: string; tabs: TabItem[]; modelBacked?: boolean; persist?: 'localStorage' | 'url' | 'session' | false; activeTab?: number; animate?: boolean | { highlight?: boolean; content?: boolean } }
    return (
      <SchemaTabs
        key={`${key}-t`}
        id={tabsEl.id}
        tabs={tabsEl.tabs}
        urlSearch={ctx.urlSearch}
        panelPath={ctx.panelPath}
        pathSegment={ctx.pathSegment}
        i18n={ctx.i18n}
        modelBacked={!!tabsEl.modelBacked}
        persist={tabsEl.persist}
        activeTab={tabsEl.activeTab}
        animate={tabsEl.animate}
        renderDashboard={ctx.renderDashboard}
      />
    )
  }

  if (el.type === 'section') {
    const sectionEl = el as SchemaSectionProps['section']
    return (
      <SchemaSection
        key={`${key}-s`}
        section={sectionEl}
        panelPath={ctx.panelPath}
        pathSegment={ctx.pathSegment}
        i18n={ctx.i18n}
        urlSearch={ctx.urlSearch}
        renderDashboard={ctx.renderDashboard}
      />
    )
  }

  if (el.type === 'dashboard' && ctx.renderDashboard) {
    return ctx.renderDashboard(el as DashboardEl, index)
  }

  return (
    <SchemaElementRenderer
      key={key}
      element={el as PanelSchemaElementMeta}
      panelPath={ctx.panelPath}
      i18n={ctx.i18n}
    />
  )
}
