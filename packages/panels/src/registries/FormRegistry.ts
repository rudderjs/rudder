import type { FormSubmitFn } from '../schema/Form.js'
import type { PanelContext } from '../types.js'
import { createRegistry } from './BaseRegistry.js'

interface FormEntry {
  handler: FormSubmitFn
  beforeSubmit?: ((data: Record<string, unknown>, ctx: PanelContext) => Promise<Record<string, unknown>>) | undefined
  afterSubmit?: ((result: Record<string, unknown>, ctx: PanelContext) => Promise<void>) | undefined
}

const base = createRegistry<FormEntry>()

/**
 * @internal — runtime registry of Form submit handlers and lifecycle hooks.
 * Populated by resolveSchema() on the first SSR request that includes the form.
 * Looked up by the form submit API endpoint.
 */
export const FormRegistry = {
  register(panelName: string, formId: string, handler: FormSubmitFn): void {
    const existing = base.get(panelName, formId)
    base.register(panelName, formId, { ...existing, handler })
  },

  registerHooks(
    panelName: string,
    formId: string,
    hooks: {
      beforeSubmit?: FormEntry['beforeSubmit']
      afterSubmit?: FormEntry['afterSubmit']
    },
  ): void {
    const existing = base.get(panelName, formId)
    if (existing) {
      if (hooks.beforeSubmit) existing.beforeSubmit = hooks.beforeSubmit
      if (hooks.afterSubmit) existing.afterSubmit = hooks.afterSubmit
    } else {
      base.register(panelName, formId, { handler: async () => {}, ...hooks })
    }
  },

  get(panelName: string, formId: string): FormSubmitFn | undefined {
    return base.get(panelName, formId)?.handler
  },

  getEntry(panelName: string, formId: string): FormEntry | undefined {
    return base.get(panelName, formId)
  },

  /** @internal — for testing */
  reset(): void {
    base.reset()
  },
}
