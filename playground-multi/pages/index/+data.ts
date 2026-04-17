import { auth } from '@rudderjs/auth'

export type Data = {
  user: { id: string; name: string; email: string } | null
}

export async function data(): Promise<Data> {
  const current = await auth().user() as Record<string, unknown> | null
  if (!current) return { user: null }

  return {
    user: {
      id:    String(current['id']    ?? ''),
      name:  String(current['name']  ?? ''),
      email: String(current['email'] ?? ''),
    },
  }
}
