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

  // ─── Optional lifecycle hooks (uncomment to use) ──────────

  // protected override prepareForValidation(input: Record<string, unknown>) {
  //   // Mutate input before validation, e.g.:
  //   // if (typeof input.email === 'string') input.email = input.email.toLowerCase()
  // }

  // protected override messages() {
  //   // Per-request error message overrides keyed by dot-path.
  //   return { /* email: 'Please enter a valid email.' */ }
  // }

  // protected override after() {
  //   // Cross-field checks against parsed data; addError(path, msg) collects errors.
  //   return [
  //     // ({ data, addError, req }) => { if (data.from === data.to) addError('to', 'Same account') },
  //   ]
  // }

  // protected override async passedValidation(data: unknown) {
  //   // Final transform after all checks pass; return value replaces resolved data.
  //   return data
  // }
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
    testKind:    'unit',
    stub,
  })
}
