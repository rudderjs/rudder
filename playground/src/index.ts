import { app, handleFetch } from '../bootstrap/app.ts'

let bootPromise: Promise<unknown> | null = null

export default {
  async fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response> {
    if (!bootPromise) bootPromise = app.bootstrap()
    await bootPromise
    return handleFetch(request, env, ctx)
  },
}
