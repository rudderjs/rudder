import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string): string {
  return `import { ServiceProvider } from '@rudderjs/core'

export class ${className} extends ServiceProvider {
  register(): void {
    // TODO: bind services into the container
    // this.app.singleton(MyService, () => new MyService())
  }

  async boot(): Promise<void> {
    // TODO: run logic after all providers are registered
  }
}
`
}

export function makeProvider(program: Command): void {
  registerMake(program, {
    command:     'make:provider',
    description: 'Create a new service provider class',
    label:       'Provider created',
    suffix:      'ServiceProvider',
    directory:   'app/Providers',
    stub,
  })
}
