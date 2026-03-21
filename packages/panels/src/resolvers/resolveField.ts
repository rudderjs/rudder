import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { FormElementMeta } from '../schema/Form.js'
import type { Field } from '../schema/Field.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import { ComputeRegistry } from '../registries/ComputeRegistry.js'

export async function resolveField(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta | null> {
  if (typeof (el as unknown as Field).getName !== 'function' || typeof (el as unknown as Field).getLabel !== 'function') {
    return null
  }

  const field = el as unknown as Field
  const fieldName = field.getName()
  const formId = `_standalone_${fieldName}`

  // Resolve initial value
  const initialValues: Record<string, unknown> = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = field as any
  const def = typeof f.resolveDefault === 'function' ? f.resolveDefault(ctx) : undefined
  if (def !== undefined) initialValues[fieldName] = def

  // Resolve persist(url/session) SSR value
  if (typeof f.getPersistMode === 'function') {
    const mode = f.getPersistMode()
    if (mode === 'url' && ctx.urlSearch) {
      const urlKey = `${formId}_${fieldName}`
      const urlValue = ctx.urlSearch[urlKey]
      if (urlValue !== undefined) initialValues[fieldName] = urlValue
    } else if (mode === 'session' && ctx.sessionGet) {
      try {
        const sessionValue = ctx.sessionGet(`form:${formId}:${fieldName}`)
        if (sessionValue !== undefined) initialValues[fieldName] = sessionValue
      } catch { /* session not available */ }
    }
  }

  // Register derive function if present
  if (typeof f.getFrom === 'function' && typeof f.getDeriveFn === 'function') {
    const fromFields = f.getFrom() as string[] | undefined
    const computeFn = f.getDeriveFn() as ((values: Record<string, unknown>) => unknown) | undefined
    if (fromFields && fromFields.length > 0 && computeFn) {
      ComputeRegistry.register(panel.getName(), `${formId}:${fieldName}`, { from: fromFields, compute: computeFn })
      const depValues: Record<string, unknown> = {}
      for (const dep of fromFields) depValues[dep] = initialValues[dep]
      try { initialValues[fieldName] = computeFn(depValues) } catch { /* compute failed */ }
    }
  }

  const fieldMeta = field.toMeta()
  const formMeta: FormElementMeta = {
    type: 'form',
    id: formId,
    fields: [fieldMeta],
    standalone: true,
  }
  if (Object.keys(initialValues).length > 0) {
    (formMeta as FormElementMeta & { initialValues?: Record<string, unknown> }).initialValues = initialValues
  }

  return formMeta as PanelSchemaElementMeta
}
