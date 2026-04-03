import { app } from '@rudderjs/core'
import type { BetterAuthInstance } from '@rudderjs/auth'

export type Data = {
  user: { id: string; name: string; email: string } | null
}

export async function data(pageContext: unknown): Promise<Data> {
  const auth    = app().make<BetterAuthInstance>('auth')
  const ctx     = pageContext as { headers?: Record<string, string> }
  const session = await auth.api.getSession({
    headers: new Headers(ctx.headers ?? {}),
  })
  return { user: session?.user ?? null }
}
