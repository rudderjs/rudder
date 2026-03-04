import { Mailable } from '@boostkit/mail'

export class WelcomeEmail extends Mailable {
  constructor(private readonly userName: string) {
    super()
  }

  build(): this {
    return this
      .subject(`Welcome to BoostKit, ${this.userName}!`)
      .html(`
        <h1>Welcome, ${this.userName}!</h1>
        <p>Thanks for joining BoostKit. Your account is ready.</p>
        <p>— The BoostKit Team</p>
      `)
      .text(`Welcome, ${this.userName}!\n\nThanks for joining BoostKit. Your account is ready.\n\n— The BoostKit Team`)
  }
}
