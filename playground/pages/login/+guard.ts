import { redirect } from 'vike/abort'
import { app } from '@forge/core'
import type { BetterAuthInstance } from '@forge/auth-better-auth'
import type { GuardAsync } from 'vike/types'

export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  if (!pageContext.headers) return  // client-side navigation: skip (app() is server-only)
  const auth    = app().make<BetterAuthInstance>('auth')
  const session = await auth.api.getSession({
    headers: new Headers(pageContext.headers),
  })
  if (session?.user) throw redirect('/')
}
