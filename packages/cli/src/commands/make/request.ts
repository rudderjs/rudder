import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import { FormRequest, z } from '@rudderjs/core'

export class ${className} extends FormRequest {
  authorize(): boolean {
    return true
  }

  rules() {
    return z.object({
      // TODO: define validation rules
    })
  }
}
`
}

export function makeRequest(program: Command): void {
  registerMake(program, {
    command:     'make:request',
    description: 'Create a new form request class',
    label:       'Request created',
    suffix:      'Request',
    directory:   'app/Http/Requests',
    stub,
  })
}
