import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import { Middleware } from '@rudderjs/middleware'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

export class ${className} extends Middleware {
  async handle(
    req: AppRequest,
    res: AppResponse,
    next: () => Promise<void>
  ): Promise<void> {
    // TODO: implement middleware logic
    await next()
  }
}
`
}

export function makeMiddleware(program: Command): void {
  registerMake(program, {
    command:     'make:middleware',
    description: 'Create a new middleware class',
    label:       'Middleware created',
    suffix:      'Middleware',
    directory:   'app/Http/Middleware',
    stub,
  })
}
