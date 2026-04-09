import { redirect, render } from 'vike/abort'
import type { GuardAsync } from 'vike/types'

export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  if (!import.meta.env.SSR) return
  const { PanelRegistry } = await import('@pilotiq/panels')
  const { panel: pathSegment } = pageContext.routeParams as { panel: string }
  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)

  if (!panel) throw render(404)

  // Redirect root panel path to first resource only if no schema is defined
  if (pageContext.urlPathname === `/${pathSegment}`) {
    if (!panel.hasSchema()) {
      const first = panel.getResources()[0]
      if (first) throw redirect(`/${pathSegment}/resources/${first.getSlug()}`)
    }
  }

  // Run the panel's guard if defined
  const panelGuard = panel.getGuard()
  if (panelGuard) {
    const { app } = await import('@rudderjs/core')
    let user: Record<string, unknown> | undefined
    try {
      const manager = app().make<{
        guard(name?: string): { user(): Promise<{ getAuthIdentifier(): string; [k: string]: unknown } | null> }
      }>('auth.manager')
      const authUser = await manager.guard().user()
      if (authUser) {
        const record = authUser as unknown as Record<string, unknown>
        user = {
          id:    authUser.getAuthIdentifier(),
          ...Object.fromEntries(
            Object.entries(record).filter(([_k, v]) => typeof v !== 'function' && _k !== 'password'),
          ),
        }
      }
    } catch { /* auth not configured */ }

    const allowed = await panelGuard({
      user: user as any,
      headers: (pageContext as any).headers ?? {},
      path:    pageContext.urlPathname,
      params:  {},
    })

    if (!allowed) throw redirect(`/login?redirect=${encodeURIComponent(pageContext.urlPathname)}`)
  }
}
