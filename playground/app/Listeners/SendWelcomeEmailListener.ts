import { Mail } from '@forge/mail'
import type { Listener } from '@forge/events'
import type { UserRegistered } from '../Events/UserRegistered.js'
import { WelcomeEmail } from '../Mail/WelcomeEmail.js'

export class SendWelcomeEmailListener implements Listener<UserRegistered> {
  async handle(event: UserRegistered): Promise<void> {
    await Mail.to(event.email).send(new WelcomeEmail(event.name))
  }
}
