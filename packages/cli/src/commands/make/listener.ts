import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import type { Listener } from '@rudderjs/core'

export class ${className} implements Listener {
  async handle(event: unknown): Promise<void> {
    // TODO: implement listener logic
  }
}
`
}

export function makeListener(program: Command): void {
  registerMake(program, {
    command:     'make:listener',
    description: 'Create a new event listener class',
    label:       'Listener created',
    directory:   'app/Listeners',
    stub,
  })
}
