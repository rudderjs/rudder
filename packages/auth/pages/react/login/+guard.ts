import { redirect } from 'vike/abort'
import type { GuardAsync } from 'vike/types'
import type { BetterAuthInstance } from '@boostkit/auth'

export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  // import.meta.env.SSR is a Vite compile-time constant — tree-shaken from client bundle
  if (!import.meta.env.SSR) return
  const { app } = await import('@boostkit/core')
  const auth    = app().make<BetterAuthInstance>('auth')
  const session = await auth.api.getSession({
    headers: new Headers(pageContext.headers ?? {}),
  })
  // Already logged in — redirect to home
  if (session?.user) throw redirect('/')
}
