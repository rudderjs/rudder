import { Model, type ModelObserver } from '@rudderjs/orm'
import { HasApiTokens } from '@rudderjs/passport'
import { Billable } from '@rudderjs/cashier-paddle'
import { dispatch } from '@rudderjs/core'
import { UserRegistered } from '../Events/UserRegistered.js'

export class User extends Billable(HasApiTokens(Model)) {
  static table = 'user'
  static hidden = ['password', 'rememberToken']

  id!:            string
  name!:          string
  email!:         string
  password!:      string | null
  role!:          string
  rememberToken!: string | null
  createdAt!:     Date
  updatedAt!:     Date
}

// Fires UserRegistered on every User row creation (sign-up flow, seeders, etc.).
// Keeps the event contract tied to the model rather than one controller, so
// any code path that creates a user gets the downstream effect (welcome email).
class UserObserver implements ModelObserver {
  async created(record: Record<string, unknown>): Promise<void> {
    await dispatch(new UserRegistered(
      String(record['id']    ?? ''),
      String(record['name']  ?? ''),
      String(record['email'] ?? ''),
    ))
  }
}

User.observe(UserObserver)
