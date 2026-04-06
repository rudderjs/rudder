import type { AppRequest } from '@rudderjs/core'
import type { PanelContext } from '../../types.js'

export function buildContext(req: AppRequest): PanelContext {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user:    (req as any).user,
    headers: req.headers as Record<string, string>,
    path:    req.path,
    params:  {},
  }
}

export function liveBroadcast(slug: string, event: string, data: unknown): void {
  void import('@rudderjs/broadcast').then(({ broadcast }) => {
    broadcast(`panel:${slug}`, event, data)
  }).catch(() => { /* @rudderjs/broadcast not registered */ })
}
