import type { MakeSpec } from '@rudderjs/console'

/**
 * `pnpm rudder make:factory User` → `app/Factories/UserFactory.ts`
 *
 * Stub matches the real `ModelFactory` abstract-class shape (see
 * `packages/orm/src/factory.ts`): subclass + `protected modelClass` +
 * `definition()` returning the seed attrs. The runtime is class-based,
 * not Laravel's `Factory.define()` callback style.
 *
 * The base model name is inferred from the factory's stem — `UserFactory`
 * imports `User` from `App/Models/User.js`. Users rename if their model
 * file doesn't match the convention.
 */
export const makeFactorySpec: MakeSpec = {
  command:     'make:factory',
  description: 'Create a new model factory class',
  label:       'Factory created',
  suffix:      'Factory',
  directory:   'app/Factories',
  stub: (className) => {
    // `UserFactory` → `User`. If the user passes a name already ending in
    // `Factory`, suffix logic above already preserved the original. Strip
    // the suffix to recover the model name.
    const modelName = className.replace(/Factory$/, '')
    return `import { ModelFactory, sequence } from '@rudderjs/orm'
import { ${modelName} } from 'App/Models/${modelName}.js'

export class ${className} extends ModelFactory<{
  // Fill in the attribute shape for ${modelName} — TS infers definition() against this.
  name:  string
  email: string
}> {
  protected modelClass = ${modelName}

  definition() {
    return {
      name:  'Example',
      email: sequence(i => \`user\${i}@example.com\`)(),
    }
  }

  // Named states — call ${className}.new().state('<name>').create()
  // protected states() {
  //   return {
  //     admin: () => ({ role: 'admin' as const }),
  //   }
  // }
}
`
  },
}
