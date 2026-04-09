import { PanelRegistry, resolveForm } from '@pilotiq/panels'
import type { PanelSchemaElementMeta } from '@pilotiq/panels'
import { buildPanelContext } from '../../../../_lib/buildPanelContext.js'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const { panel: pathSegment, resource: slug } = pageContext.routeParams as { panel: string; resource: string }

  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)
  if (!panel) throw new Error(`Panel "/${pathSegment}" not found.`)

  const ResourceClass = panel.getResources().find((R) => R.getSlug() === slug)
  if (!ResourceClass) throw new Error(`Resource "${slug}" not found.`)

  const resource     = new ResourceClass()
  const fullMeta     = resource.toMeta()
  // Create page only needs identity labels — form config is in formElement
  const resourceMeta = { label: fullMeta.label, labelSingular: fullMeta.labelSingular }
  const panelMeta    = panel.toNavigationMeta()
  const { ctx, sessionUser } = await buildPanelContext(pageContext)

  const form = resource._resolveForm()
  form.action(`/${pathSegment}/api/${slug}`)
  form.method('POST')

  const formElement = await resolveForm(form as any, panel, ctx)

  // Parse ?prefill[field]=value from URL
  const prefill: Record<string, string> = {}
  const urlParams = pageContext.urlParsed?.search ?? {}
  for (const [k, v] of Object.entries(urlParams)) {
    const m = k.match(/^prefill\[(.+)\]$/)
    if (m?.[1]) prefill[m[1]] = String(v)
  }

  const backHref = urlParams['back'] ?? `/${pathSegment}/resources/${slug}`

  return {
    panelMeta, resourceMeta, formElement, pathSegment, slug, sessionUser,
    ...(Object.keys(prefill).length > 0 ? { prefill } : {}),
    ...(backHref !== `/${pathSegment}/resources/${slug}` ? { backHref } : {}),
  }
}
