import { useState, useEffect } from 'react'
import { getField } from '@rudderjs/panels'
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

  // Built-in field types — always rendered consistently on SSR and client
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
    case 'text':
    case 'email':
    case 'number':
    case 'date':
    case 'datetime':      return <TextInput {...props} />
  }

  // Unknown type — plugin field that registers async (e.g. mediaPicker).
  // Resolve on client only to avoid SSR/client hydration mismatch.
  return <PluginFieldInput {...props} />
}

/** Resolves a plugin-registered field component on client mount. */
function PluginFieldInput(props: FieldInputProps) {
  const customKey = props.field.component ?? props.field.type
  const [Comp, setComp] = useState<React.ComponentType<FieldInputProps> | null>(null)

  useEffect(() => {
    const existing = getField(customKey)
    if (existing) { setComp(() => existing as React.ComponentType<FieldInputProps>); return }

    const interval = setInterval(() => {
      const comp = getField(customKey)
      if (comp) {
        setComp(() => comp as React.ComponentType<FieldInputProps>)
        clearInterval(interval)
      }
    }, 50)
    return () => clearInterval(interval)
  }, [customKey])

  if (Comp) return <Comp {...props} />

  // Loading placeholder — rendered on both SSR and client initial render
  return <TextInput {...props} />
}
