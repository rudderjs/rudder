// ─── Panel ─────────────────────────────────────────────────

export { Panel } from './Panel.js'
export type { PanelMeta, PanelNavigationMeta, ResourceNavigationMeta, GlobalNavigationMeta, PanelPlugin, PanelPluginSchema } from './Panel.js'
export type { PanelI18n } from './i18n/index.js'
export { getPanelI18n, getPanelDir } from './i18n/index.js'

// ─── Theme ────────────────────────────────────────────────

export { resolveTheme, generateThemeCSS, iconMap, resolveIconName } from './theme/index.js'
export type {
  PanelThemeConfig, PanelThemeMeta,
  StylePreset, BaseColor, AccentColor, RadiusPreset, ChartPalette,
  IconLibrary, ThemeFonts, PresetDefinition,
} from './theme/index.js'

// ─── Page ──────────────────────────────────────────────────

export { Page } from './Page.js'
export type { PageMeta } from './Page.js'

// ─── Resource ──────────────────────────────────────────────

export { Resource } from './Resource.js'
export type { ResourceMeta, FieldOrGrouping, SchemaItemMeta } from './Resource.js'

// ─── Global ────────────────────────────────────────────────

export { Global } from './Global.js'
export type { GlobalMeta } from './Global.js'

// ─── Groupings ─────────────────────────────────────────────

export { Section } from './schema/Section.js'
export type { SectionMeta } from './schema/Section.js'
export { Tab, Tabs } from './schema/Tabs.js'
export type { TabsMeta, TabMeta, TabsPersistMode } from './schema/Tabs.js'

// ─── Persist helpers ──────────────────────────────────────────

export type { PersistMode } from './persist.js'
export type { DataSource } from './datasource.js'
export { resolveDataSource } from './datasource.js'

// ─── Field ─────────────────────────────────────────────────

export { Field } from './schema/Field.js'
export type { FieldMeta, FieldVisibility, Condition, ConditionOp } from './schema/Field.js'
export { FieldType } from './schema/FieldType.js'
export type { FieldTypeValue } from './schema/FieldType.js'

// ─── Fields ────────────────────────────────────────────────

export { TextField }    from './schema/fields/TextField.js'
export { EmailField }   from './schema/fields/EmailField.js'
export { NumberField }  from './schema/fields/NumberField.js'
export { SelectField }  from './schema/fields/SelectField.js'
export type { SelectOption } from './schema/fields/SelectField.js'
export { BooleanField }  from './schema/fields/BooleanField.js'
export { DateField }     from './schema/fields/DateField.js'
export { TextareaField } from './schema/fields/TextareaField.js'
export { RelationField } from './schema/fields/RelationField.js'
export { HasMany }       from './schema/fields/HasMany.js'
export { PasswordField } from './schema/fields/PasswordField.js'
export { SlugField }     from './schema/fields/SlugField.js'
export { TagsField }     from './schema/fields/TagsField.js'
export { HiddenField }   from './schema/fields/HiddenField.js'
export { ToggleField }   from './schema/fields/ToggleField.js'
export { ColorField }    from './schema/fields/ColorField.js'
export { JsonField }     from './schema/fields/JsonField.js'
export { RepeaterField } from './schema/fields/RepeaterField.js'
export { BuilderField }  from './schema/fields/BuilderField.js'
export { FileField }     from './schema/fields/FileField.js'
export type { ImageConversion } from './schema/fields/FileField.js'
export { ComputedField } from './schema/fields/ComputedField.js'
export { Block }         from './schema/Block.js'
export type { BlockMeta } from './schema/Block.js'

// ─── Node Map (shared block infrastructure) ──────────────────
export {
  nodeId, emptyNodeMap,
  addNode, updateNodeProps, removeNode, removeNodeRecursive, moveNode, moveNodeToParent, reorderNode,
  arrayToNodeMap, repeaterArrayToNodeMap, nodeMapToArray, ensureNodeMap,
} from './NodeMap.js'
export type { NodeData, NodeMap } from './NodeMap.js'

// ─── Component Registry ─────────────────────────────────────

export { registerField, getField, subscribeFields, registerElement, getElement, registerLazyElement, getLazyElement } from './registries/ComponentRegistry.js'

// ─── Resolver Registry ──────────────────────────────────────

export { registerResolver, getResolver } from './registries/ResolverRegistry.js'

// ─── Editor Registry (deprecated — use registerField instead) ──

/** @deprecated Use `registerField` instead. */
export { editorRegistry } from './registries/EditorRegistry.js'
export type { RichContentEditorProps, CollaborativePlainTextProps } from './registries/EditorRegistry.js'

// ─── Tabs ───────────────────────────────────────────────────

export { ListTab } from './schema/Tab.js'
export type { ListTabMeta } from './schema/Tab.js'

// ─── Filters ───────────────────────────────────────────────

export { Filter, SelectFilter, SearchFilter } from './schema/Filter.js'
export type { FilterMeta, FilterOption } from './schema/Filter.js'
export { DateFilter }    from './schema/filters/DateFilter.js'
export { BooleanFilter } from './schema/filters/BooleanFilter.js'
export { NumberFilter }  from './schema/filters/NumberFilter.js'
export { QueryFilter }   from './schema/filters/QueryFilter.js'

// ─── Actions ───────────────────────────────────────────────

export { Action } from './schema/Action.js'
export type { ActionMeta, ActionHandler } from './schema/Action.js'
export { ActionGroup } from './schema/ActionGroup.js'
export type { ActionGroupMeta } from './schema/ActionGroup.js'
export { Import } from './schema/Import.js'
export type { ImportMeta, ImportColumnMapping } from './schema/Import.js'
export { Wizard, Step } from './schema/Wizard.js'
export type { WizardMeta, StepMeta } from './schema/Wizard.js'
export { RelationManager } from './schema/RelationManager.js'
export type { RelationManagerMeta } from './schema/RelationManager.js'
// ─── Schema elements ───────────────────────────────────────

export { Text }    from './schema/Text.js'
export { Heading } from './schema/Heading.js'
export { Code }    from './schema/Code.js'
export type { CodeElementMeta } from './schema/Code.js'
export { Snippet } from './schema/Snippet.js'
export type { SnippetElementMeta, SnippetTab } from './schema/Snippet.js'
export { Example } from './schema/Example.js'
export type { ExampleElementMeta } from './schema/Example.js'
export { Card } from './schema/Card.js'
export type { CardElementMeta } from './schema/Card.js'
export { Alert } from './schema/Alert.js'
export type { AlertElementMeta, AlertType } from './schema/Alert.js'
export { Divider } from './schema/Divider.js'
export type { DividerElementMeta } from './schema/Divider.js'
export { Each } from './schema/Each.js'
export type { EachElementMeta, EachLayout } from './schema/Each.js'
export { View } from './schema/View.js'
export type { ViewElementMeta } from './schema/View.js'
export { Playground } from './schema/Playground.js'
export type { PlaygroundElementMeta } from './schema/Playground.js'
export { Stats, Stat } from './schema/Stats.js'
export { Table }               from './schema/Table.js'
export { Chart }   from './schema/Chart.js'
export { List, List as DataView } from './schema/List.js'
export { ViewMode } from './schema/ViewMode.js'
export { DataField } from './schema/DataField.js'
export type { DataFieldMeta, DataFieldType } from './schema/DataField.js'
export { Form }    from './schema/Form.js'
export type { FormElementMeta, FormElementMeta as SchemaFormMeta, FormSubmitFn, FormItem } from './schema/Form.js'
export { Column }  from './schema/Column.js'
export type { ColumnMeta, EditMode } from './schema/Column.js'
export { Dialog }  from './schema/Dialog.js'
export type { DialogElementMeta, DialogElementMeta as SchemaDialogMeta } from './schema/Dialog.js'
export type {
  TextElementMeta,
  HeadingElementMeta,
  StatsElementMeta,
  PanelStatMeta,
  /** @deprecated Tables now resolve as DataViewElementMeta. */
  TableElementMeta,
  TableConfig,
  /** @deprecated Use `TableConfig` instead. */
  TableConfig as Table2Config,
  PanelColumnMeta,
  ChartElementMeta,
  ChartDataset,
  ChartType,
  ListElementMeta,
  ListItem,
  ListConfig,
  ViewModeMeta,
} from './schema/index.js'

// ─── Schema resolver ────────────────────────────────────────

export { resolveSchema } from './resolveSchema.js'
export type { PanelSchemaElementMeta } from './resolveSchema.js'
export { resolveDataView } from './resolvers/resolveListElement.js'
/** @deprecated Use `resolveDataView` instead. */
export { resolveDataView as resolveTable } from './resolvers/resolveListElement.js'
/** @deprecated Use `resolveDataView` instead. */
export { resolveDataView as resolveListElement } from './resolvers/resolveListElement.js'
export type { DataViewElementMeta } from './resolvers/resolveListElement.js'
export { resolveListQuery } from './resolvers/resolveListQuery.js'
export { resolveTabs }  from './resolvers/resolveTabs.js'
export { resolveActiveTabIndex } from './resolvers/helpers.js'
export { resolveForm }  from './resolvers/resolveForm.js'
export { flattenFields } from './handlers/utils.js'

// ─── Registries ─────────────────────────────────────────────

export { PanelRegistry } from './registries/PanelRegistry.js'
export { DashboardRegistry } from './registries/DashboardRegistry.js'
export { FormRegistry } from './registries/FormRegistry.js'
export { TableRegistry } from './registries/TableRegistry.js'
export { StatsRegistry } from './registries/StatsRegistry.js'
export { TabsRegistry } from './registries/TabsRegistry.js'

// ─── Provider ──────────────────────────────────────────────

export { PanelServiceProvider, panels, buildDefaultLayout } from './PanelServiceProvider.js'

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
  QueryBuilderLike,
  RecordRow,
  FormValues,
  RequestBody,
  SchemaElementLike,
} from './types.js'

// ─── Agents ────────────────────────────────────────────────

export { ResourceAgent } from './agents/ResourceAgent.js'
export type { ResourceAgentContext } from './agents/ResourceAgent.js'
export type { ResourceAgentMeta } from './agents/types.js'

// ─── Data helpers ───────────────────────────────────────────

export { resourceData } from './resourceData.js'
export type { ResourceDataContext, ResourceDataResult } from './resourceData.js'

// ─── Widget ─────────────────────────────────────────────
export { Widget } from './schema/Widget.js'
export type { WidgetSize, WidgetMeta, WidgetSettingsField, WidgetSchemaFn } from './schema/Widget.js'

// ─── Dashboard ──────────────────────────────────────────
export { Dashboard } from './schema/Dashboard.js'
export type { DashboardMeta } from './schema/Dashboard.js'
