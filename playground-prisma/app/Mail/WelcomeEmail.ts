import { Mailable } from '@rudderjs/mail'

export class WelcomeEmail extends Mailable {
  constructor(private readonly userName: string) {
    super()
  }

  build(): this {
    return this
      .subject(`Welcome to RudderJS, ${this.userName}!`)
      .html(`
        <h1>Welcome, ${this.userName}!</h1>
        <p>Thanks for joining RudderJS. Your account is ready.</p>
        <p>— The RudderJS Team</p>
      `)
      .text(`Welcome, ${this.userName}!\n\nThanks for joining RudderJS. Your account is ready.\n\n— The RudderJS Team`)
  }
}
