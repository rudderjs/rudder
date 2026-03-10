// ─── Panel ─────────────────────────────────────────────────

export { Panel } from './Panel.js'
export type { PanelMeta } from './Panel.js'

// ─── Page ──────────────────────────────────────────────────

export { Page } from './Page.js'
export type { PageMeta } from './Page.js'

// ─── Resource ──────────────────────────────────────────────

export { Resource } from './Resource.js'
export type { ResourceMeta } from './Resource.js'

// ─── Field ─────────────────────────────────────────────────

export { Field } from './Field.js'
export type { FieldMeta, FieldVisibility } from './Field.js'

// ─── Fields ────────────────────────────────────────────────

export { TextField }    from './fields/TextField.js'
export { EmailField }   from './fields/EmailField.js'
export { NumberField }  from './fields/NumberField.js'
export { SelectField }  from './fields/SelectField.js'
export type { SelectOption } from './fields/SelectField.js'
export { BooleanField } from './fields/BooleanField.js'
export { DateField }    from './fields/DateField.js'
export { TextareaField } from './fields/TextareaField.js'
export { RelationField } from './fields/RelationField.js'

// ─── Filters ───────────────────────────────────────────────

export { Filter, SelectFilter, SearchFilter } from './Filter.js'
export type { FilterMeta, FilterOption } from './Filter.js'

// ─── Actions ───────────────────────────────────────────────

export { Action } from './Action.js'
export type { ActionMeta, ActionHandler } from './Action.js'

// ─── Registry ──────────────────────────────────────────────

export { PanelRegistry } from './PanelRegistry.js'

// ─── Provider ──────────────────────────────────────────────

export { PanelServiceProvider, panels } from './PanelServiceProvider.js'

// ─── Types ─────────────────────────────────────────────────

export type {
  PolicyAction,
  PanelContext,
  PanelUser,
  PanelGuard,
  BrandingOptions,
  PanelLayout,
  PaginatedResult,
  ModelClass,
} from './types.js'

// ─── Data helpers ───────────────────────────────────────────

export { resourceData } from './resourceData.js'
export type { ResourceDataContext, ResourceDataResult } from './resourceData.js'
