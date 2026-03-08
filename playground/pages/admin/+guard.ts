import { redirect } from 'vike/abort'
import type { GuardAsync } from 'vike/types'

export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  if (!import.meta.env.SSR) return
  if (pageContext.urlPathname !== '/admin') return
  const { PanelRegistry } = await import('@boostkit/panels')
  const panel = PanelRegistry.get('admin')
  const first = panel?.getResources()[0]
  if (first) throw redirect(`/admin/${first.getSlug()}`)
}
