import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export function stub(className: string, table: string): string {
  return `import { Model } from '@rudderjs/orm'

export class ${className} extends Model {
  static table = '${table}'

  static fillable: string[] = []

  static hidden: string[] = []
}
`
}

export function deriveTable(className: string): string {
  // PascalCase → snake_case, then pluralise
  return (
    className
      .replace(/([A-Z])/g, (m, l, i) => (i === 0 ? l : `_${l}`))
      .toLowerCase() + 's'
  )
}

export function makeModel(program: Command): void {
  registerMake(program, {
    command:     'make:model',
    description: 'Create a new ORM model class',
    label:       'Model created',
    directory:   'app/Models',
    stub:        (className) => stub(className, deriveTable(className)),
  })
}
