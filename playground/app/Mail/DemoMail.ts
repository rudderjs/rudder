import { Mailable } from '@rudderjs/mail'

/**
 * Demo mailable — built dynamically from the to/subject the user enters.
 * Replace with whatever copy your real templates need (HTML + text).
 */
export class DemoMail extends Mailable {
  constructor(private readonly heading: string) { super() }

  build(): this {
    return this
      .subject(this.heading)
      .html(`<h1>${this.heading}</h1><p>Sent from the RudderJS mail demo.</p>`)
      .text(`${this.heading}\n\nSent from the RudderJS mail demo.`)
  }
}
