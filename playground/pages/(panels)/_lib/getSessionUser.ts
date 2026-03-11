// ─── Shared SSR helper — resolve authenticated user from request headers ──────

export interface SessionUser {
  name?:  string
  email?: string
  image?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getSessionUser(pageContext: any): Promise<SessionUser | undefined> {
  try {
    const { app } = await import('@boostkit/core')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth    = app().make<any>('auth')
    const session = await auth.api.getSession({
      headers: new Headers(pageContext.headers ?? {}),
    })
    return session?.user ?? undefined
  } catch {
    return undefined
  }
}
