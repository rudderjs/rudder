import type { Command } from 'commander'
import { registerMake } from './_shared.js'

export type ControllerKind = 'plain' | 'resource' | 'api' | 'singleton'

/** Default decorator-driven controller — single `@Get('/')` handler. */
export function stub(className: string, prefix: string): string {
  return `import { Controller, Get } from '@rudderjs/router'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'

@Controller('${prefix}')
export class ${className} {
  @Get('/')
  async index(req: AppRequest, res: AppResponse) {
    return []
  }
}
`
}

/**
 * Full RESTful resource stub — plain class, no decorators. Wire via
 * `router.resource('<name>', ${className})`. Method names match the seven
 * canonical verbs Laravel exposes; missing ones are silently skipped by
 * `router.resource()`, so trim freely if a verb doesn't apply.
 */
export function resourceStub(className: string): string {
  return `import type { AppRequest, AppResponse } from '@rudderjs/contracts'

// Wire via: router.resource('${derivePluralResourceName(className)}', ${className})
export class ${className} {
  async index   (req: AppRequest, res: AppResponse) { return [] }
  async create  (req: AppRequest, res: AppResponse) { /* render create form */ }
  async store   (req: AppRequest, res: AppResponse) { /* persist new record */ }
  async show    (req: AppRequest, res: AppResponse) { /* render one record */ }
  async edit    (req: AppRequest, res: AppResponse) { /* render edit form */ }
  async update  (req: AppRequest, res: AppResponse) { /* persist update */ }
  async destroy (req: AppRequest, res: AppResponse) { /* delete record */ }
}
`
}

/** API-only resource stub — drops `create` + `edit` (HTML form pages). */
export function apiResourceStub(className: string): string {
  return `import type { AppRequest, AppResponse } from '@rudderjs/contracts'

// Wire via: router.apiResource('${derivePluralResourceName(className)}', ${className})
export class ${className} {
  async index   (req: AppRequest, res: AppResponse) { return [] }
  async store   (req: AppRequest, res: AppResponse) { /* persist new record */ }
  async show    (req: AppRequest, res: AppResponse) { /* render one record */ }
  async update  (req: AppRequest, res: AppResponse) { /* persist update */ }
  async destroy (req: AppRequest, res: AppResponse) { /* delete record */ }
}
`
}

/** Singleton stub — `show` / `edit` / `update` only. */
export function singletonStub(className: string): string {
  return `import type { AppRequest, AppResponse } from '@rudderjs/contracts'

// Wire via: router.singleton('${deriveSingularResourceName(className)}', ${className})
export class ${className} {
  async show   (req: AppRequest, res: AppResponse) { /* render the resource */ }
  async edit   (req: AppRequest, res: AppResponse) { /* render edit form */ }
  async update (req: AppRequest, res: AppResponse) { /* persist update */ }
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

function derivePluralResourceName(className: string): string {
  return derivePrefix(className).replace(/^\//, '')
}

function deriveSingularResourceName(className: string): string {
  const plural = derivePluralResourceName(className)
  if (/[^aeiou]ies$/i.test(plural))     return plural.slice(0, -3) + 'y'
  if (/(s|x|z|ch|sh)es$/i.test(plural)) return plural.slice(0, -2)
  if (/s$/i.test(plural) && !/ss$/i.test(plural)) return plural.slice(0, -1)
  return plural
}

/** Pick the right stub based on parsed CLI opts. Returns kind + body. */
export function pickStub(className: string, opts: Record<string, unknown>): { kind: ControllerKind; body: string } {
  if (opts['resource'])  return { kind: 'resource',  body: resourceStub(className) }
  if (opts['api'])       return { kind: 'api',       body: apiResourceStub(className) }
  if (opts['singleton']) return { kind: 'singleton', body: singletonStub(className) }
  return { kind: 'plain', body: stub(className, derivePrefix(className)) }
}

export function makeController(program: Command): void {
  registerMake(program, {
    command:     'make:controller',
    description: 'Create a new controller class',
    label:       'Controller created',
    suffix:      'Controller',
    directory:   'app/Http/Controllers',
    testKind:    'feature',
    stub:        (className, opts) => pickStub(className, opts).body,
    extraOptions: [
      { flags: '-r, --resource',  description: 'Generate a full RESTful resource controller (7 verbs)' },
      { flags: '-a, --api',       description: 'Generate an API-only resource controller (no create/edit)' },
      { flags: '-s, --singleton', description: 'Generate a singleton resource controller (show/edit/update)' },
    ],
  })
}
