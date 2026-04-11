import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `export class ${className} {
  constructor(
    // public readonly userId: string,
  ) {}
}
`
}

export function makeEvent(program: Command): void {
  registerMake(program, {
    command:     'make:event',
    description: 'Create a new event class',
    label:       'Event created',
    directory:   'app/Events',
    stub,
  })
}
