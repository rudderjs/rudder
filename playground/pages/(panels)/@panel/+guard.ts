import { redirect, render } from 'vike/abort'
import type { GuardAsync } from 'vike/types'

export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  if (!import.meta.env.SSR) return
  const { PanelRegistry } = await import('@boostkit/panels')
  const { panel: pathSegment } = pageContext.routeParams as { panel: string }
  const panel = PanelRegistry.all().find((p) => p.getPath() === `/${pathSegment}`)

  if (!panel) throw render(404)

  // Redirect root panel path to first resource
  if (pageContext.urlPathname === `/${pathSegment}`) {
    const first = panel.getResources()[0]
    if (first) throw redirect(`/${pathSegment}/${first.getSlug()}`)
  }

  // Run the panel's guard if defined
  const panelGuard = panel.getGuard()
  if (panelGuard) {
    const { app } = await import('@boostkit/core')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth    = app().make<any>('auth')
    const session = await auth.api.getSession({
      headers: new Headers(pageContext.headers ?? {}),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = session?.user as any

    const allowed = await panelGuard({
      user,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headers: (pageContext as any).headers ?? {},
      path:    pageContext.urlPathname,
    })

    if (!allowed) throw redirect(`/login?redirect=${encodeURIComponent(pageContext.urlPathname)}`)
  }
}
