import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import { Mailable } from '@rudderjs/mail'

export class ${className} extends Mailable {
  constructor(/* inject data here */) {
    super()
  }

  build(): this {
    return this
      .subject('Your subject here')
      .html('<p>Your HTML content here</p>')
      .text('Your plain text content here')
  }
}
`
}

export function makeMail(program: Command): void {
  registerMake(program, {
    command:     'make:mail',
    description: 'Create a new mailable class',
    label:       'Mailable created',
    directory:   'app/Mail',
    stub,
  })
}
