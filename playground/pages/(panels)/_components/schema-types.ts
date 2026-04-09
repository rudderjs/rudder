import type { PanelSchemaElementMeta, PanelI18n } from '@pilotiq/panels'
import type { DashboardGridProps } from './DashboardGrid.js'

export type DashboardLayoutItem = DashboardGridProps['ssrLayout'] extends (infer T)[] | undefined ? T : never

export interface TabItem { label: string; elements?: SchemaElement[]; icon?: string; lazy?: boolean; badge?: string | number | null; [key: string]: unknown }

export type DashboardEl = {
  type: 'dashboard'; id: string; label?: string; editable: boolean
  widgets: unknown[]; savedLayout?: unknown[]
}

export type SchemaElement = PanelSchemaElementMeta | {
  type: 'widget'; id?: string; defaultSize?: { w: number; h: number }; [key: string]: unknown
} | DashboardEl | {
  type: 'section'; title: string; description?: string; collapsible: boolean
  collapsed: boolean; columns: number; elements?: SchemaElement[]
} | {
  type: 'tabs'; id?: string; tabs: TabItem[]
} | {
  type: 'form'; id?: string; [key: string]: unknown
} | {
  type: 'dialog'; id?: string; [key: string]: unknown
}

export type I18nExtended = PanelI18n & Record<string, string>
