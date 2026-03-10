import type { FieldMeta } from '@boostkit/panels'

/**
 * Custom field renderer props — same interface as built-in FieldInput.
 * Your component receives the field metadata, current value, and an onChange callback.
 */
export interface FieldInputProps {
  field:    FieldMeta
  value:    unknown
  onChange: (value: unknown) => void
}

/**
 * Register custom field renderers here.
 *
 * Key = the string passed to Field.component('your-key') in your Resource.
 * Value = a React component that renders the form input for that field.
 *
 * @example
 * import { ColorPicker } from '../../components/ColorPicker.js'
 *
 * export const customFieldRenderers: Record<string, React.ComponentType<FieldInputProps>> = {
 *   'color-picker': ColorPicker,
 * }
 */
export const customFieldRenderers: Record<string, React.ComponentType<FieldInputProps>> = {}
