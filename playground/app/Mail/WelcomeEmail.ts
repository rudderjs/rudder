import { Mailable } from '@rudderjs/mail'

export class WelcomeEmail extends Mailable {
  constructor(private readonly userName: string) {
    super()
  }

  build(): this {
    return this
      .subject(`Welcome to Rudder, ${this.userName}!`)
      .html(`
        <h1>Welcome, ${this.userName}!</h1>
        <p>Thanks for joining Rudder. Your account is ready.</p>
        <p>— The Rudder Team</p>
      `)
      .text(`Welcome, ${this.userName}!\n\nThanks for joining Rudder. Your account is ready.\n\n— The Rudder Team`)
  }
}
