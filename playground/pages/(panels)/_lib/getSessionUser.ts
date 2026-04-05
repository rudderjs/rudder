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
    try {
      const manager = app().make<{
        guard(name?: string): { user(): Promise<{ getAuthIdentifier(): string; [k: string]: unknown } | null> }
      }>('auth.manager')
      const authUser = await manager.guard().user()
      if (!authUser) return undefined
      const record = authUser as unknown as Record<string, unknown>
      const slim: SessionUser = {}
      if (record['name'] && typeof record['name'] === 'string')   slim.name  = record['name']
      if (record['email'] && typeof record['email'] === 'string') slim.email = record['email']
      if (record['image'] && typeof record['image'] === 'string') slim.image = record['image']
      return slim
    } catch { /* auth.manager not bound */ }
    return undefined
  } catch {
    return undefined
  }
}
