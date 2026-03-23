import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike, QueryBuilderLike, RecordRow } from '../types.js'
import type { FieldOrGrouping } from '../Resource.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'

/** Minimal interface for elements that expose getConfig() (e.g. Table). */
export interface ConfigurableElement extends SchemaElementLike {
  getConfig(): import('../schema/Table.js').TableConfig
}

/** Minimal interface for a Form schema element. */
export interface FormElement extends SchemaElementLike {
  getId(): string
  getSubmitHandler?(): ((data: Record<string, unknown>, ctx: PanelContext) => Promise<void | Record<string, unknown>>) | undefined
}

/** Minimal interface for a Dialog schema element. */
export interface DialogElement extends SchemaElementLike {
  getItems(): unknown[]
  toMeta(): import('../schema/Dialog.js').DialogElementMeta
}

/** Minimal interface for a Widget schema element. */
export interface WidgetElement extends SchemaElementLike {
  getSchemaFn?(): import('../schema/Widget.js').WidgetSchemaFn | undefined
  toMeta(): import('../schema/Widget.js').WidgetMeta & { type: 'widget' }
}

/** Minimal interface for a Resource class (static shape). */
export interface ResourceLike {
  new(): {
    _resolveForm(): { getFields(): FieldOrGrouping[] }
  }
  model?: ModelLike
  getSlug?(): string
}

/** Minimal interface for a Model class (static shape). */
export interface ModelLike {
  query(): QueryBuilderLike<RecordRow>
}

/** Minimal interface for @boostkit/core `app()` factory. */
export interface AppLike {
  make(key: string): unknown
}

/** Type for the resolveSchema function when passed as parameter. */
export type ResolveSchemaFn = (panel: Panel, ctx: PanelContext) => Promise<PanelSchemaElementMeta[]>
