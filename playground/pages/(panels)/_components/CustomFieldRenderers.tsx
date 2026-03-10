import type { FieldMeta } from '@boostkit/panels'
import { RatingInput } from './fields/RatingInput.js'

/**
 * Custom field renderer props — same interface as built-in FieldInput.
 */
export interface FieldInputProps {
  field:    FieldMeta
  value:    unknown
  onChange: (value: unknown) => void
}

export const customFieldRenderers: Record<string, React.ComponentType<FieldInputProps>> = {
  rating: RatingInput,
}
