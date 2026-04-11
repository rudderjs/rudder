import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string, prefix: string): string {
  return `import { Controller, Get } from '@rudderjs/router'
import type { Context } from '@rudderjs/core'

@Controller('${prefix}')
export class ${className} {
  @Get('/')
  async index(_ctx: Context) {
    return []
  }
}
`
}

export function derivePrefix(className: string): string {
  const base = className.replace(/Controller$/, '')
  // PascalCase → kebab-case, then pluralise
  const kebab = base
    .replace(/([A-Z])/g, (m, l, i) => (i === 0 ? l : `-${l}`))
    .toLowerCase()
  return `/${kebab}s`
}

export function makeController(program: Command): void {
  registerMake(program, {
    command:     'make:controller',
    description: 'Create a new controller class',
    label:       'Controller created',
    suffix:      'Controller',
    directory:   'app/Http/Controllers',
    stub:        (className) => stub(className, derivePrefix(className)),
  })
}
