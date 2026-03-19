import type { FormSubmitFn } from './schema/Form.js'
import type { PanelContext } from './types.js'

interface FormEntry {
  handler: FormSubmitFn
  beforeSubmit?: ((data: Record<string, unknown>, ctx: PanelContext) => Promise<Record<string, unknown>>) | undefined
  afterSubmit?: ((result: Record<string, unknown>, ctx: PanelContext) => Promise<void>) | undefined
}

/**
 * @internal — runtime registry of Form submit handlers and lifecycle hooks.
 * Populated by resolveSchema() on the first SSR request that includes the form.
 * Looked up by the form submit API endpoint.
 */
export class FormRegistry {
  private static entries = new Map<string, FormEntry>()

  static register(panelName: string, formId: string, handler: FormSubmitFn): void {
    const key = `${panelName}:${formId}`
    const existing = FormRegistry.entries.get(key)
    FormRegistry.entries.set(key, { ...existing, handler })
  }

  static registerHooks(
    panelName: string,
    formId: string,
    hooks: {
      beforeSubmit?: FormEntry['beforeSubmit']
      afterSubmit?: FormEntry['afterSubmit']
    },
  ): void {
    const key = `${panelName}:${formId}`
    const existing = FormRegistry.entries.get(key)
    if (existing) {
      if (hooks.beforeSubmit) existing.beforeSubmit = hooks.beforeSubmit
      if (hooks.afterSubmit) existing.afterSubmit = hooks.afterSubmit
    } else {
      FormRegistry.entries.set(key, { handler: async () => {}, ...hooks })
    }
  }

  static get(panelName: string, formId: string): FormSubmitFn | undefined {
    return FormRegistry.entries.get(`${panelName}:${formId}`)?.handler
  }

  static getEntry(panelName: string, formId: string): FormEntry | undefined {
    return FormRegistry.entries.get(`${panelName}:${formId}`)
  }

  /** @internal — for testing */
  static reset(): void {
    FormRegistry.entries.clear()
  }
}
