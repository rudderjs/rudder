import { resolve } from '@rudderjs/core'
import { UserService } from '../../app/Services/UserService.js'

export type Data = Awaited<ReturnType<typeof data>>

export async function data() {
  // resolve() pulls the UserService singleton registered by AppServiceProvider
  const userService = resolve<UserService>(UserService)

  return {
    users: await userService.findAll(),
  }
}
