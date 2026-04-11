import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import { Job } from '@rudderjs/queue'

export class ${className} extends Job {
  static queue   = 'default'
  static retries = 3

  constructor(/* inject payload here */) {
    super()
  }

  async handle(): Promise<void> {
    // TODO: implement job logic
  }
}
`
}

export function makeJob(program: Command): void {
  registerMake(program, {
    command:     'make:job',
    description: 'Create a new queue job class',
    label:       'Job created',
    directory:   'app/Jobs',
    stub,
  })
}
