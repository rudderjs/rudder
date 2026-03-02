import { Mailable } from '@forge/mail'

export class WelcomeEmail extends Mailable {
  constructor(private readonly userName: string) {
    super()
  }

  build(): this {
    return this
      .subject(`Welcome to Forge, ${this.userName}!`)
      .html(`
        <h1>Welcome, ${this.userName}!</h1>
        <p>Thanks for joining Forge. Your account is ready.</p>
        <p>— The Forge Team</p>
      `)
      .text(`Welcome, ${this.userName}!\n\nThanks for joining Forge. Your account is ready.\n\n— The Forge Team`)
  }
}
