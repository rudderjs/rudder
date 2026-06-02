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

// Tighten the generic to a concrete attribute shape once ${modelName}'s
// fields are declared — e.g. \`ModelFactory<{ name: string; email: string }>\`
// for tsc to type-check definition() returns and create() arguments. The
// initial \`any\` is intentional: a concrete generic only type-checks against
// the model's declared fields, and a freshly scaffolded model has none, so
// pinning a shape here would mean every \`make:model X; make:factory X\`
// pair fails tsc until the model is filled in. Replace once your shape is
// stable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ${className} extends ModelFactory<any> {
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

// Wire \`${modelName}.factory()\` (the Laravel-style entry point) by adding
// \`static factoryClass = ${className}\` to App/Models/${modelName}.ts. Then:
//   await ${modelName}.factory().create()
//   await ${modelName}.factory().has(Post.factory(), 3).create()   // hasMany/hasOne children
//   await Post.factory().for(${modelName}.factory()).create()      // belongsTo parent
`
  },
}
