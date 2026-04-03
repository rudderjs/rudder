// ─── Shared SSR helper — resolve authenticated user from request headers ──────

export interface SessionUser {
  name?:  string
  email?: string
  image?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getSessionUser(pageContext: any): Promise<SessionUser | undefined> {
  try {
    const { app } = await import('@rudderjs/core')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth    = app().make<any>('auth')
    const session = await auth.api.getSession({
      headers: new Headers(pageContext.headers ?? {}),
    })
    const u = session?.user
    if (!u) return undefined
    // Return only the fields the panel UI needs — strip emailVerified, createdAt, updatedAt, etc.
    const slim: SessionUser = {}
    if (u.name)  slim.name  = u.name
    if (u.email) slim.email = u.email
    if (u.image) slim.image = u.image
    return slim
  } catch {
    return undefined
  }
}
