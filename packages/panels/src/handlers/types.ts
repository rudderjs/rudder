import type { AppRequest, AppResponse, MiddlewareHandler } from '@boostkit/core'

export type RouteHandler = (req: AppRequest, res: AppResponse) => unknown | Promise<unknown>

export interface RouterLike {
  get(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
  post(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
  put(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
  delete(path: string, handler: RouteHandler, mw?: MiddlewareHandler[]): void
}
