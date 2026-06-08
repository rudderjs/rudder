import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import type { Authenticatable } from '@rudderjs/auth'
import { Policy } from '@rudderjs/auth'

/**
 * Authorization policy. Register it against a model in a provider's boot():
 *
 *   Gate.policy(Post, ${className})
 *
 * then authorize with Gate.allows('update', post) / Gate.authorize(...).
 * Each method below is an "ability" — return true to allow, false to deny.
 */
export class ${className} extends Policy {
  /**
   * Runs before every ability. Return true/false to short-circuit (e.g. grant
   * admins everything), or null/undefined to fall through to the ability below.
   */
  // before(user: Authenticatable) {
  //   return null
  // }

  viewAny(_user: Authenticatable): boolean {
    return true
  }

  view(_user: Authenticatable, _model: unknown): boolean {
    return true
  }

  create(_user: Authenticatable): boolean {
    return true
  }

  update(_user: Authenticatable, _model: unknown): boolean {
    return false
  }

  delete(_user: Authenticatable, _model: unknown): boolean {
    return false
  }
}
`
}

export function makePolicy(program: Command): void {
  registerMake(program, {
    command:     'make:policy',
    description: 'Create a new authorization policy class',
    label:       'Policy created',
    suffix:      'Policy',
    directory:   'app/Policies',
    testKind:    'unit',
    stub,
  })
}
