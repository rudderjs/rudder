import type { AppRequest } from '@rudderjs/core'
import type { Panel } from '../../../Panel.js'
import type { ChatRequestBody } from '../types.js'
import type { ChatContext } from './types.js'
import { ResourceChatContext } from './ResourceChatContext.js'
import { PageChatContext } from './PageChatContext.js'
import { GlobalChatContext } from './GlobalChatContext.js'

export interface ResolveContextDeps {
  body:  ChatRequestBody
  panel: Panel
  req:   AppRequest
}

/**
 * Pick the right ChatContext for an incoming request. Each branch may throw
 * `ChatContextError` (caught by the dispatcher and turned into a JSON 4xx).
 */
export async function resolveContext(deps: ResolveContextDeps): Promise<ChatContext> {
  const { body } = deps
  if (body.resourceContext) return ResourceChatContext.create(deps)
  if (body.pageContext)     return PageChatContext.create(deps)
  return GlobalChatContext.create(deps)
}
