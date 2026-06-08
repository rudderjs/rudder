import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import type { CastUsing } from '@rudderjs/orm'

/**
 * Custom attribute cast. Use it on a model:
 *
 *   static casts = { value: ${className} } as const satisfies Record<string, CastDefinition>
 *
 * get() transforms the raw DB value → application type (on read);
 * set() transforms the application value → DB-storable type (on write).
 * Both MUST be synchronous — a cast that returns a Promise stores '[object Promise]'.
 */
export class ${className} implements CastUsing {
  get(_key: string, value: unknown, _attributes: Record<string, unknown>): unknown {
    return value
  }

  set(_key: string, value: unknown, _attributes: Record<string, unknown>): unknown {
    return value
  }
}
`
}

export function makeCast(program: Command): void {
  registerMake(program, {
    command:     'make:cast',
    description: 'Create a new custom attribute cast class',
    label:       'Cast created',
    // No suffix — Laravel parity (make:cast Json → Json), and casts read
    // cleanly as nouns in `static casts = { col: Json }`.
    directory:   'app/Casts',
    testKind:    'unit',
    stub,
  })
}
