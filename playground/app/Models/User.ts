import { Model, type ModelObserver } from '@rudderjs/orm'
import { HasApiTokens } from '@rudderjs/passport'
import { Billable } from '@rudderjs/cashier-paddle'
import { dispatch } from '@rudderjs/core'
import { UserRegistered } from 'App/Events/UserRegistered.js'

// Hand-declared fields (not Model.for<'users'>()) because the class composes
// the HasApiTokens + Billable mixins, which expect the plain Model base. The
// simpler demo models (Post, Todo, …) showcase the generated-registry binding.
export class User extends Billable(HasApiTokens(Model)) {
  static table = 'users'
  static hidden = ['password', 'rememberToken']

  id!:            number
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
