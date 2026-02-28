import { resolve } from '@forge/core'
import { GreetingService } from '../../app/Services/GreetingService.js'

export type Data = Awaited<ReturnType<typeof data>>

export async function data() {
  const greeter = resolve<GreetingService>(GreetingService)

  return {
    title:   'Welcome to Forge',
    message: greeter.greet('World'),
  }
}
