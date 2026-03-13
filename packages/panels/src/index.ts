// ─── Panel ─────────────────────────────────────────────────

export { Panel } from './Panel.js'
export type { PanelMeta } from './Panel.js'
export type { PanelI18n } from './i18n/index.js'
export { getPanelI18n, getPanelDir } from './i18n/index.js'

// ─── Page ──────────────────────────────────────────────────

export { Page } from './Page.js'
export type { PageMeta } from './Page.js'

// ─── Resource ──────────────────────────────────────────────

export { Resource } from './Resource.js'
export type { ResourceMeta, FieldOrGrouping, SchemaItemMeta } from './Resource.js'

// ─── Groupings ─────────────────────────────────────────────

export { Section } from './Section.js'
export type { SectionMeta } from './Section.js'
export { Tabs } from './Tabs.js'
export type { TabsMeta, TabMeta } from './Tabs.js'

// ─── Field ─────────────────────────────────────────────────

export { Field } from './Field.js'
export type { FieldMeta, FieldVisibility, Condition, ConditionOp } from './Field.js'

// ─── Fields ────────────────────────────────────────────────

export { TextField }    from './fields/TextField.js'
export { EmailField }   from './fields/EmailField.js'
export { NumberField }  from './fields/NumberField.js'
export { SelectField }  from './fields/SelectField.js'
export type { SelectOption } from './fields/SelectField.js'
export { BooleanField }  from './fields/BooleanField.js'
export { DateField }     from './fields/DateField.js'
export { TextareaField } from './fields/TextareaField.js'
export { RelationField } from './fields/RelationField.js'
export { HasMany }       from './fields/HasMany.js'
export { PasswordField } from './fields/PasswordField.js'
export { SlugField }     from './fields/SlugField.js'
export { TagsField }     from './fields/TagsField.js'
export { HiddenField }   from './fields/HiddenField.js'
export { ToggleField }   from './fields/ToggleField.js'
export { ColorField }    from './fields/ColorField.js'
export { JsonField }     from './fields/JsonField.js'
export { RepeaterField } from './fields/RepeaterField.js'
export { BuilderField }  from './fields/BuilderField.js'
export { FileField }     from './fields/FileField.js'
export { ComputedField } from './fields/ComputedField.js'
export { Block }         from './Block.js'
export type { BlockMeta } from './Block.js'

// ─── Node Map (shared block infrastructure) ──────────────────
export {
  nodeId, emptyNodeMap,
  addNode, updateNodeProps, removeNode, removeNodeRecursive, moveNode, moveNodeToParent, reorderNode,
  arrayToNodeMap, repeaterArrayToNodeMap, nodeMapToArray, ensureNodeMap,
} from './NodeMap.js'
export type { NodeData, NodeMap } from './NodeMap.js'

// ─── Content Field ───────────────────────────────────────────
export { ContentField }     from './fields/ContentField.js'
export { contentBlockDefs } from './ContentBlock.js'
export type { ContentBlockDef } from './ContentBlock.js'

// ─── Filters ───────────────────────────────────────────────

export { Filter, SelectFilter, SearchFilter } from './Filter.js'
export type { FilterMeta, FilterOption } from './Filter.js'

// ─── Actions ───────────────────────────────────────────────

export { Action } from './Action.js'
export type { ActionMeta, ActionHandler } from './Action.js'

// ─── Schema elements ───────────────────────────────────────

export { Text }    from './schema/Text.js'
export { Heading } from './schema/Heading.js'
export { Stats, Stat } from './schema/Stats.js'
export { Table }   from './schema/Table.js'
export type {
  TextElementMeta,
  HeadingElementMeta,
  StatsElementMeta,
  PanelStatMeta,
  TableElementMeta,
  PanelColumnMeta,
} from './schema/index.js'

// ─── Schema resolver ────────────────────────────────────────

export { resolveSchema } from './resolveSchema.js'
export type { PanelSchemaElementMeta } from './resolveSchema.js'

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
