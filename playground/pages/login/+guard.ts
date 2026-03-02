import { redirect } from 'vike/abort'
import type { GuardAsync } from 'vike/types'
import type { BetterAuthInstance } from '@forge/auth-better-auth'

export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  // import.meta.env.SSR is a Vite compile-time constant — this entire block is
  // tree-shaken from the client bundle, keeping @forge/core server-only.
  if (!import.meta.env.SSR) return
  const { app } = await import('@forge/core')
  const auth    = app().make<BetterAuthInstance>('auth')
  const session = await auth.api.getSession({
    headers: new Headers(pageContext.headers ?? {}),
  })
  if (session?.user) throw redirect('/')
}
