import type { AppRequest } from '@boostkit/core'
import type { Panel } from '../../Panel.js'
import { buildContext } from '../utils.js'
import { debugWarn } from '../../debug.js'

/**
 * Warm up all registries by resolving the panel schema AND all page schemas.
 * Tables/Stats/Tabs/Forms on custom Pages need this to be found by API endpoints.
 */
export async function warmUpRegistries(panel: Panel, req: AppRequest): Promise<void> {
  const { resolveSchema } = await import('../../resolveSchema.js') as { resolveSchema: typeof import('../../resolveSchema.js').resolveSchema }
  const ctx = buildContext(req)

  // Resolve main panel schema
  if (panel.hasSchema()) {
    await resolveSchema(panel, ctx)
  }

  // Resolve all page schemas
  for (const PageClass of panel.getAllPages()) {
    if (!PageClass.hasSchema()) continue
    try {
      const elements = await PageClass.schema(ctx)
      const pagePanel = Object.create(panel, {
        getSchema: { value: () => elements },
      })
      await resolveSchema(pagePanel, ctx)
    } catch { /* page schema failed */ }
  }

  // Register resource tables for lazy/poll/paginated API endpoints
  const { resolveListElement } = await import('../../resolvers/resolveListElement.js')
  for (const ResourceClass of panel.getResources()) {
    if (!ResourceClass.model) continue
    try {
      const resource = new ResourceClass()
      const table = resource._resolveTable()
      await resolveListElement(table as any, panel, ctx)
    } catch { /* resource schema failed */ }
  }
}

/**
 * Lazy-load @boostkit/image (optional peer — not a dependency of panels)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function importImage(): Promise<{ image: (input: Buffer) => any }> {
  const pkg = '@boostkit/image'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return import(/* @vite-ignore */ pkg) as any
}

export { debugWarn, buildContext }
