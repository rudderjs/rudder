import type { MakeSpec } from '@rudderjs/console'

/**
 * `pnpm rudder make:resource User` → `app/Resources/UserResource.ts`
 *
 * Stub matches the real `JsonResource` abstract-class shape (see
 * `packages/orm/src/resource.ts`): subclass + `toArray()` returning the
 * wire-format object, with the conditional helpers (`when`/`whenLoaded`)
 * shown as commented examples.
 *
 * The base model name is inferred from the resource's stem — `UserResource`
 * imports `User` from `App/Models/User.js`. Users rename if their model
 * file doesn't match the convention.
 */
export const makeResourceSpec: MakeSpec = {
  command:     'make:resource',
  description: 'Create a new API resource class',
  label:       'Resource created',
  suffix:      'Resource',
  directory:   'app/Resources',
  stub: (className) => {
    // `UserResource` → `User`. If the user passes a name already ending in
    // `Resource`, suffix logic above already preserved the original. Strip
    // the suffix to recover the model name.
    const modelName = className.replace(/Resource$/, '')
    const instanceName = modelName.charAt(0).toLowerCase() + modelName.slice(1)
    return `import { JsonResource } from '@rudderjs/orm'
import { ${modelName} } from 'App/Models/${modelName}.js'

// Tighten the generic to \`JsonResource<${modelName}>\` once ${modelName}'s fields are
// declared — \`this.resource\` then type-checks in toArray(). The initial
// \`any\` is intentional: a freshly scaffolded model declares no fields, so
// \`this.resource.id\` against \`JsonResource<${modelName}>\` would fail tsc until
// the model is filled in (same posture as the make:factory stub).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class ${className} extends JsonResource<any> {
  toArray() {
    return {
      id: this.resource.id,
      // name:  this.resource.name,
      // admin: this.when(this.resource.role === 'admin', true),
      // posts: this.whenLoaded('posts', PostResource.collection(this.resource.posts as Post[])),
    }
  }
}

// In a route handler:
//   return res.json(new ${className}(${instanceName}).toArray())
//   return res.json(await ${className}.collection(${instanceName}s).toResponse())
`
  },
}
