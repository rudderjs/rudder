import { getField } from '@boostkit/panels'
import type { FieldInputProps } from './fields/types.js'
import { BooleanInput } from './fields/BooleanInput.js'
import { SelectInput } from './fields/SelectInput.js'
import { TextareaInput } from './fields/TextareaInput.js'
import { PasswordInput } from './fields/PasswordInput.js'
import { SlugInput } from './fields/SlugInput.js'
import { TagsInput } from './fields/TagsInput.js'
import { HiddenInput } from './fields/HiddenInput.js'
import { ToggleInput } from './fields/ToggleInput.js'
import { ColorInput } from './fields/ColorInput.js'
import { JsonInput } from './fields/JsonInput.js'
import { FileInput } from './fields/FileInput.js'
import { RepeaterInput } from './fields/RepeaterInput.js'
import { BuilderInput } from './fields/BuilderInput.js'
import { BelongsToInput } from './fields/BelongsToInput.js'
import { BelongsToManyInput } from './fields/BelongsToManyInput.js'
import { RichContentInput } from './fields/RichContentInput.js'
import { TextInput } from './fields/TextInput.js'

export type { FieldInputProps } from './fields/types.js'

export function FieldInput(props: FieldInputProps) {
  const { field } = props

  // Check registry first — custom fields and plugin-registered fields take priority
  const customKey = field.component ?? field.type
  const Custom = getField(customKey)
  if (Custom) {
    return <Custom {...props} />
  }

  switch (field.type) {
    case 'boolean':       return <BooleanInput {...props} />
    case 'select':        return <SelectInput {...props} />
    case 'textarea':      return <TextareaInput {...props} />
    case 'password':      return <PasswordInput {...props} />
    case 'slug':          return <SlugInput {...props} />
    case 'tags':          return <TagsInput {...props} />
    case 'hidden':        return <HiddenInput {...props} />
    case 'toggle':        return <ToggleInput {...props} />
    case 'color':         return <ColorInput {...props} />
    case 'json':          return <JsonInput {...props} />
    case 'repeater':      return <RepeaterInput {...props} />
    case 'builder':       return <BuilderInput {...props} />
    case 'file':
    case 'image':         return <FileInput {...props} />
    case 'belongsTo':     return <BelongsToInput {...props} />
    case 'belongsToMany': return <BelongsToManyInput {...props} />
    case 'richcontent':   return <RichContentInput {...props} />
    default:              return <TextInput {...props} />
  }
}
