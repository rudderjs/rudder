import { redirect } from 'vike/abort'
import type { GuardAsync } from 'vike/types'
import type { BetterAuthInstance } from '@rudderjs/auth'

export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  // import.meta.env.SSR is a Vite compile-time constant — tree-shaken from client bundle
  if (!import.meta.env.SSR) return
  const { app } = await import('@rudderjs/core')
  const auth    = app().make<BetterAuthInstance>('auth')
  const session = await auth.api.getSession({
    headers: new Headers(pageContext.headers ?? {}),
  })
  // Already registered and logged in — redirect to home
  if (session?.user) throw redirect('/')
}
