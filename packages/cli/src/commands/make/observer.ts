import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import type { ModelObserver } from '@rudderjs/orm'

/**
 * Model observer. Register it on a model (e.g. in a provider's boot()):
 *
 *   Post.observe(${className})
 *
 * Implement any subset of the lifecycle hooks below — 'creating'/'updating'/
 * 'saving' may return a (possibly mutated) attributes object; 'deleting'/
 * 'updating'/'restoring' may return false to cancel the operation.
 */
export class ${className} implements ModelObserver {
  creating(data: Record<string, unknown>): Record<string, unknown> | void {
    // TODO: inspect/mutate attributes before the row is inserted
    return data
  }

  created(_record: Record<string, unknown>): void {
    // TODO: react after the row is inserted
  }

  updating(_id: string | number, data: Record<string, unknown>): Record<string, unknown> | false | void {
    return data
  }

  updated(_record: Record<string, unknown>): void {}

  deleted(_id: string | number): void {}
}
`
}

export function makeObserver(program: Command): void {
  registerMake(program, {
    command:     'make:observer',
    description: 'Create a new model observer class',
    label:       'Observer created',
    suffix:      'Observer',
    directory:   'app/Observers',
    testKind:    'unit',
    stub,
  })
}
