import type { ComponentType } from 'react'

/**
 * Runtime component registries for custom fields and schema elements.
 *
 * Plugins and user code call `registerField()` / `registerElement()` to add
 * custom renderers. `FieldInput` and `SchemaElementRenderer` check these
 * before their built-in switch/if-chain.
 *
 * @example
 * // Register a custom field input
 * import { registerField } from '@boostkit/panels'
 * import ColorPicker from './fields/ColorPicker'
 * registerField('color', ColorPicker)
 *
 * // Register a custom schema element
 * import { registerElement } from '@boostkit/panels'
 * import MediaBrowser from './elements/MediaBrowser'
 * registerElement('media-browser', MediaBrowser)
 */

// ─── Field Registry ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fieldMap = new Map<string, ComponentType<any>>()

/**
 * Register a custom field input component.
 *
 * The key should match `Field.make('x').component('key')` or the field type.
 * The component receives `{ field, value, onChange, ...rest }` (FieldInputProps).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerField(key: string, component: ComponentType<any>): void {
  fieldMap.set(key, component)
}

/**
 * Look up a registered field component by key.
 * @internal — used by FieldInput.tsx
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getField(key: string): ComponentType<any> | undefined {
  return fieldMap.get(key)
}

// ─── Element Registry ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const elementMap = new Map<string, ComponentType<any>>()

/**
 * Register a custom schema element renderer.
 *
 * The key should match the `type` field in the resolved schema meta.
 * The component receives `{ element, panelPath, i18n }` (SchemaElementRendererProps).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerElement(key: string, component: ComponentType<any>): void {
  elementMap.set(key, component)
}

/**
 * Look up a registered element component by type.
 * @internal — used by SchemaElementRenderer.tsx
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getElement(key: string): ComponentType<any> | undefined {
  return elementMap.get(key)
}
