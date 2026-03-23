import type { Panel } from '../Panel.js'
import type { PanelContext, SchemaElementLike } from '../types.js'
import type { FormElementMeta } from '../schema/Form.js'
import type { PanelSchemaElementMeta } from '../resolveSchema.js'
import type { FormElement } from './types.js'
import { FormRegistry } from '../registries/FormRegistry.js'
import { ComputeRegistry } from '../registries/ComputeRegistry.js'
import { debugWarn } from '../debug.js'

export async function resolveForm(
  el: SchemaElementLike,
  panel: Panel,
  ctx: PanelContext,
): Promise<PanelSchemaElementMeta> {
  const form = el as FormElement
  const handler = form.getSubmitHandler?.()
  if (handler) {
    FormRegistry.register(panel.getName(), form.getId(), handler)
  }

  // Store fields for server-side validation in submit endpoint
  const rawFields = (form as unknown as { getFields?(): unknown[] }).getFields?.() ?? []
  FormRegistry.registerFields(panel.getName(), form.getId(), rawFields as import('../schema/Field.js').Field[])

  // Register lifecycle hooks
  const beforeSubmit = (form as unknown as { getBeforeSubmit?(): unknown }).getBeforeSubmit?.() as
    ((data: Record<string, unknown>, ctx: PanelContext) => Promise<Record<string, unknown>>) | undefined
  const afterSubmit = (form as unknown as { getAfterSubmit?(): unknown }).getAfterSubmit?.() as
    ((result: Record<string, unknown>, ctx: PanelContext) => Promise<void>) | undefined
  const refreshes = (form as unknown as { getRefreshes?(): string[] }).getRefreshes?.() ?? []
  if (beforeSubmit || afterSubmit || refreshes.length > 0) {
    FormRegistry.registerHooks(panel.getName(), form.getId(), {
      beforeSubmit,
      afterSubmit,
      ...(refreshes.length > 0 ? { refreshes } : {}),
    })
  }

  const formMeta = form.toMeta() as FormElementMeta & { initialValues?: Record<string, unknown> }

  // Resolve initial values: field defaults → persist(url/session) → .data(fn)
  // Priority: .data(fn) > persist restored > field .default()
  const initialValues: Record<string, unknown> = {}

  // 1. Resolve field defaults (static only — functions resolved client-side)
  const formFields = (form as unknown as { getFields?(): Array<{ getName(): string; resolveDefault(ctx: unknown): unknown; getPersistMode(): unknown }> }).getFields?.() ?? []
  for (const field of formFields) {
    if (typeof field.getName !== 'function') continue
    const def = field.resolveDefault(ctx)
    if (def !== undefined) initialValues[field.getName()] = def
  }

  // 2. Resolve persist(url/session) values from SSR context
  const formId = form.getId()
  for (const field of formFields) {
    if (typeof field.getName !== 'function' || typeof field.getPersistMode !== 'function') continue
    const mode = field.getPersistMode()
    const fieldName = field.getName()

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

  // 3. .data(fn) overrides everything
  const dataFn = (form as unknown as { getDataFn?(): ((ctx: PanelContext) => Promise<Record<string, unknown>>) | undefined }).getDataFn?.()
  if (dataFn) {
    try {
      const dataValues = await dataFn(ctx)
      Object.assign(initialValues, dataValues)
    } catch (e) { debugWarn('form.data', e) }
  }

  // 4. Register compute functions and compute initial values
  interface ComputeFieldLike {
    getName(): string
    getFrom?(): string[] | undefined
    getDeriveFn?(): ((values: Record<string, unknown>) => unknown) | undefined
  }
  for (const field of formFields) {
    const f = field as unknown as ComputeFieldLike
    if (typeof f.getFrom === 'function' && typeof f.getDeriveFn === 'function') {
      const fromFields = f.getFrom!()
      const computeFn = f.getDeriveFn!()
      if (fromFields && fromFields.length > 0 && computeFn) {
        const fieldName = f.getName()
        // Register for API recomputation
        ComputeRegistry.register(panel.getName(), `${formId}:${fieldName}`, { from: fromFields, compute: computeFn })
        // Compute initial value from current initialValues
        const depValues: Record<string, unknown> = {}
        for (const dep of fromFields) depValues[dep] = initialValues[dep]
        try {
          initialValues[fieldName] = computeFn(depValues)
        } catch { /* compute failed */ }
      }
    }
  }

  if (Object.keys(initialValues).length > 0) {
    formMeta.initialValues = initialValues
  }

  // 5. Detect collaborative fields and set up Yjs config
  interface YjsFieldLike {
    isYjs?(): boolean
    getYjsProviders?(): string[]
  }
  const yjsFields = formFields.filter((f) => {
    const yf = f as unknown as YjsFieldLike
    return typeof yf.isYjs === 'function' && yf.isYjs()
  })
  if (yjsFields.length > 0) {
    const needsWebsocket = yjsFields.some((f) => {
      const yf = f as unknown as YjsFieldLike
      const providers = typeof yf.getYjsProviders === 'function' ? yf.getYjsProviders() : []
      return providers.includes('websocket')
    })

    const docName = `form:${formId}`
    formMeta.yjs = true
    formMeta.wsLivePath = needsWebsocket ? '/ws-live' : null
    formMeta.docName = docName

    // Collect all providers
    const providers = new Set<string>()
    for (const f of yjsFields) {
      const yf = f as unknown as YjsFieldLike
      const fp = typeof yf.getYjsProviders === 'function' ? yf.getYjsProviders() : []
      for (const p of fp) providers.add(p)
    }
    formMeta.liveProviders = [...providers]

    // Seed Y.Doc with initial values (server-side)
    if (needsWebsocket && Object.keys(initialValues).length > 0) {
      try {
        const livePkg = '@boostkit/live'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { Live } = await import(/* @vite-ignore */ livePkg) as any
        if (Live?.seed) {
          await Live.seed(docName, initialValues)
        }
      } catch { /* @boostkit/live not available */ }
    }
  }

  return formMeta as PanelSchemaElementMeta
}
