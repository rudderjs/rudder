import { redirect } from 'vike/abort'
import type { GuardAsync } from 'vike/types'

export const guard: GuardAsync = async (pageContext): ReturnType<GuardAsync> => {
  if (!import.meta.env.SSR) return
  // Check if user is already logged in via session
  const { app } = await import('@rudderjs/core')
  const { AuthManager, runWithAuth } = await import('@rudderjs/auth')
  const manager = app().make<InstanceType<typeof AuthManager>>('auth.manager')
  let isLoggedIn = false
  await runWithAuth(manager, async () => {
    const { Auth } = await import('@rudderjs/auth')
    isLoggedIn = await Auth.check()
  })
  if (isLoggedIn) throw redirect('/')
}
