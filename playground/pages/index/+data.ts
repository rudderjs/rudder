import { resolve, app } from '@boostkit/core'
import type { BetterAuthInstance } from '@boostkit/auth'
import { trans } from '@boostkit/localization'
import { GreetingService } from '../../app/Services/GreetingService.js'
import type { PageContextServer } from 'vike/types'

export type Data = Awaited<ReturnType<typeof data>>

export async function data(pageContext: PageContextServer) {
  const greeter = resolve<GreetingService>(GreetingService)
  const auth    = app().make<BetterAuthInstance>('auth')

  const session = await auth.api.getSession({
    headers: new Headers(pageContext.headers ?? {}),
  })

  return {
    title:   await trans('messages.welcome'),
    message: greeter.greet('World'),
    user:    session?.user ?? null,
  }
}
