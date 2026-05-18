import type { TemplateContext } from './templates.js'

export type Frameworks = ('react' | 'vue' | 'solid')[]
export type Orm        = 'prisma' | 'drizzle' | false
export type Db         = 'sqlite' | 'postgresql' | 'mysql'
export type Recipe     = 'web-app' | 'saas' | 'api-service' | 'realtime' | 'minimal' | 'custom'
export type Styling    = 'tailwind+shadcn' | 'tailwind' | 'plain'

export interface Answers {
  name:       string
  recipe:     Recipe
  orm:        Orm
  db:         Db
  packages:   TemplateContext['packages']
  /** Single framework picked in the new flow; multi-framework only via legacy --frameworks flag. */
  frameworks: Frameworks
  primary:    'react' | 'vue' | 'solid'
  tailwind:   boolean
  shadcn:     boolean
  /**
   * Demos selected for scaffolding.
   *
   * Deprecated as a user-facing concept: the recipe-driven flow always sets
   * this to `[]`. Kept on the Answers shape so the templates pipeline and
   * pre-recipe tests don't need to branch — `getTemplates` still iterates
   * it, finds nothing, and skips every demo block.
   */
  demos:      string[]
  /** Whether to run `git init` + initial commit after scaffolding. */
  git:        boolean
  /** Whether the user's DB is currently reachable — set to false to skip `db:push`. */
  dbReady:    boolean
  install:    boolean
}

/**
 * Recipe → packages preset. Each recipe is a curated bundle that covers
 * what the named scenario actually needs. "Custom" carries no preset —
 * the user picks packages via the (legacy) multiselect.
 */
export const RECIPES: Record<Exclude<Recipe, 'custom'>, {
  packages:    ReadonlyArray<keyof TemplateContext['packages']>
  needsOrm:    boolean
  needsFrontend: boolean
}> = {
  'web-app':     { packages: ['auth'],                                       needsOrm: true,  needsFrontend: true  },
  'saas':        { packages: ['auth', 'queue', 'mail', 'notifications'],     needsOrm: true,  needsFrontend: true  },
  'api-service': { packages: ['auth', 'http'],                               needsOrm: true,  needsFrontend: false },
  'realtime':    { packages: ['auth', 'broadcast', 'sync'],                  needsOrm: true,  needsFrontend: true  },
  'minimal':     { packages: [],                                             needsOrm: false, needsFrontend: false },
} as const

export type PartialAnswers = Partial<Answers>

export interface ParsedFlags {
  name:             string | undefined
  partial:          PartialAnswers
  jsonRequested:    boolean
  forceInteractive: boolean
}

export class FlagError extends Error {}

export const PACKAGE_KEYS: ReadonlyArray<keyof TemplateContext['packages']> = [
  'auth', 'sanctum', 'passport', 'socialite',
  'queue', 'storage', 'scheduler',
  'image', 'mail', 'notifications', 'broadcast', 'sync',
  'ai', 'mcp', 'boost',
  'localization', 'pennant',
  'telescope', 'pulse', 'horizon',
  'crypt', 'http', 'process', 'concurrency', 'terminal',
] as const

export const DB_GATED = new Set(['auth', 'sanctum', 'passport'])

export function emptyPackages(): TemplateContext['packages'] {
  const out = {} as TemplateContext['packages']
  for (const k of PACKAGE_KEYS) (out as Record<string, boolean>)[k] = false
  return out
}

export function packagesFromList(list: string[], orm: Orm): TemplateContext['packages'] {
  const out = emptyPackages()
  const wanted = list.includes('*')
    ? PACKAGE_KEYS.filter(k => orm !== false || !DB_GATED.has(k as string))
    : list
  for (const k of wanted) {
    if ((PACKAGE_KEYS as ReadonlyArray<string>).includes(k)) {
      ;(out as Record<string, boolean>)[k] = true
    }
  }
  return out
}

export function parseFlags(argv: string[]): ParsedFlags {
  let name: string | undefined
  const flags: Record<string, string> = {}
  const bools: Record<string, boolean> = {}

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      if (!name) name = arg
      continue
    }
    const eq = arg.indexOf('=')
    if (eq !== -1) flags[arg.slice(2, eq)] = arg.slice(eq + 1)
    else bools[arg.slice(2)] = true
  }

  const partial: PartialAnswers = {}

  if (flags['orm']) {
    const v = flags['orm']
    if (v === 'none') partial.orm = false
    else if (v === 'prisma' || v === 'drizzle') partial.orm = v
    else throw new FlagError(`--orm must be one of: prisma, drizzle, none (got "${v}")`)
  }
  if (flags['db']) {
    const v = flags['db']
    if (v === 'sqlite' || v === 'postgresql' || v === 'mysql') partial.db = v
    else throw new FlagError(`--db must be one of: sqlite, postgresql, mysql (got "${v}")`)
  }
  if (flags['packages'] !== undefined) {
    const list = flags['packages'].split(',').map(s => s.trim()).filter(Boolean)
    const valid = new Set<string>([...PACKAGE_KEYS as ReadonlyArray<string>, '*'])
    for (const k of list) {
      if (!valid.has(k)) throw new FlagError(`--packages: unknown package "${k}". Valid: ${[...valid].join(', ')}`)
    }
    partial.packages = packagesFromList(list, partial.orm ?? 'prisma')
  }
  if (flags['frameworks'] !== undefined) {
    const list = flags['frameworks'].split(',').map(s => s.trim()).filter(Boolean) as Frameworks
    for (const f of list) {
      if (f !== 'react' && f !== 'vue' && f !== 'solid') {
        throw new FlagError(`--frameworks: unknown framework "${f}". Valid: react, vue, solid`)
      }
    }
    if (list.length === 0) throw new FlagError('--frameworks must include at least one of: react, vue, solid')
    partial.frameworks = list
  }
  if (flags['primary-framework']) {
    const v = flags['primary-framework']
    if (v !== 'react' && v !== 'vue' && v !== 'solid') {
      throw new FlagError(`--primary-framework must be one of: react, vue, solid (got "${v}")`)
    }
    partial.primary = v
  }
  if ('tailwind' in flags) partial.tailwind = flags['tailwind'] === 'true'
  if ('shadcn' in flags)   partial.shadcn   = flags['shadcn']   === 'true'
  if ('install' in flags)  partial.install  = flags['install']  === 'true'
  if ('git' in flags)      partial.git      = flags['git']      === 'true'
  if ('db-ready' in flags) partial.dbReady  = flags['db-ready'] === 'true'

  // --recipe — preset that derives orm/packages/needsFrontend.
  if (flags['recipe']) {
    const v = flags['recipe']
    const valid = new Set<Recipe>(['web-app', 'saas', 'api-service', 'realtime', 'minimal', 'custom'])
    if (!valid.has(v as Recipe)) {
      throw new FlagError(`--recipe must be one of: ${[...valid].join(', ')} (got "${v}")`)
    }
    partial.recipe = v as Recipe
  }

  // --framework — singular shortcut. Maps to --frameworks=react + --primary-framework=react.
  if (flags['framework']) {
    const v = flags['framework']
    if (v !== 'react' && v !== 'vue' && v !== 'solid' && v !== 'none') {
      throw new FlagError(`--framework must be one of: react, vue, solid, none (got "${v}")`)
    }
    if (v === 'none') {
      partial.frameworks = []
    } else {
      partial.frameworks = [v]
      partial.primary    = v
    }
  }

  // --styling — collapses --tailwind + --shadcn into one. Explicit --tailwind/--shadcn override.
  if (flags['styling']) {
    const v = flags['styling']
    if (v !== 'tailwind+shadcn' && v !== 'tailwind' && v !== 'plain') {
      throw new FlagError(`--styling must be one of: tailwind+shadcn, tailwind, plain (got "${v}")`)
    }
    if (partial.tailwind === undefined) partial.tailwind = v !== 'plain'
    if (partial.shadcn   === undefined) partial.shadcn   = v === 'tailwind+shadcn'
  }

  // --demos kept as a silent no-op for backwards compatibility — demos were dropped
  // from the scaffolder default. Old scripts/CI passing `--demos=...` continue to
  // work without error; nothing is scaffolded under /demos.
  if (flags['demos'] !== undefined) { partial.demos = [] }

  return {
    name,
    partial,
    jsonRequested:    bools['json'] ?? false,
    forceInteractive: bools['interactive'] ?? false,
  }
}

/**
 * JSON-mode required-flags validation.
 *
 * Two valid call shapes:
 *   1. Recipe shortcut — `--recipe + --db + --install` (and `--framework`
 *      when the recipe has `needsFrontend: true`). Everything else inferred.
 *   2. Legacy explicit — `--orm + --packages + --frameworks + --tailwind +
 *      --install` (the pre-recipe contract; still supported for older
 *      scripts/CI).
 */
export function validateJsonMode(name: string | undefined, p: PartialAnswers): string[] {
  const missing: string[] = []
  if (!name) missing.push('<project-name>')

  if (p.recipe) {
    // Recipe path — most fields inferred from the preset.
    if (p.recipe !== 'custom' && p.recipe !== 'minimal' && !p.db) missing.push('--db')
    const preset = p.recipe === 'custom' ? null : RECIPES[p.recipe]
    if (preset?.needsFrontend && !p.frameworks?.length && !p.primary) {
      missing.push('--framework')
    }
    if (p.recipe === 'custom' && p.packages === undefined) missing.push('--packages')
    if (p.install === undefined) missing.push('--install')
    return missing
  }

  // Legacy explicit path
  if (p.orm === undefined)        missing.push('--orm')
  if (p.orm !== false && !p.db)   missing.push('--db')
  if (p.packages === undefined)   missing.push('--packages')
  if (!p.frameworks)              missing.push('--frameworks')
  if (p.frameworks && p.frameworks.length > 1 && !p.primary) missing.push('--primary-framework')
  if (p.tailwind === undefined)   missing.push('--tailwind')
  if (p.frameworks?.includes('react') && p.tailwind === true && p.shadcn === undefined) {
    missing.push('--shadcn')
  }
  if (p.install === undefined)    missing.push('--install')
  return missing
}

export function resolveJsonAnswers(name: string, p: PartialAnswers): Answers {
  // Recipe path — derive everything from the preset, with explicit flags as overrides.
  if (p.recipe) {
    const recipe = p.recipe
    const preset = recipe === 'custom' ? null : RECIPES[recipe]
    const orm: Orm = p.orm !== undefined
      ? p.orm
      : (preset?.needsOrm ? 'prisma' : false)
    const db: Db = (orm === false ? 'sqlite' : (p.db ?? 'sqlite')) as Db

    const packages = recipe === 'custom'
      ? p.packages!
      : packagesFromList([...(preset?.packages ?? [])] as string[], orm)
    // Allow explicit overrides on top of the recipe
    if (recipe !== 'custom' && p.packages) {
      for (const k of Object.keys(p.packages) as (keyof TemplateContext['packages'])[]) {
        if (p.packages[k]) (packages as Record<string, boolean>)[k] = true
      }
    }

    const wantsFrontend = preset ? preset.needsFrontend : (p.frameworks?.length ?? 0) > 0
    const frameworks: Frameworks = wantsFrontend
      ? (p.frameworks?.length ? p.frameworks : ['react'])
      : []
    const primary    = (frameworks[0] ?? p.primary ?? 'react') as 'react' | 'vue' | 'solid'
    const tailwind   = p.tailwind ?? wantsFrontend
    const shadcn     = p.shadcn ?? (wantsFrontend && primary === 'react' && tailwind)

    return {
      name, recipe, orm, db, packages, frameworks, primary, tailwind, shadcn,
      demos:   [],
      git:     p.git     ?? true,
      dbReady: p.dbReady ?? (db === 'sqlite'),
      install: p.install!,
    }
  }

  // Legacy explicit path (pre-recipe)
  const orm        = p.orm!
  const db         = (orm === false ? 'sqlite' : p.db!) as Db
  const packages   = p.packages!
  const frameworks = p.frameworks!
  const primary    = p.primary ?? frameworks[0]!
  const tailwind   = p.tailwind!
  const shadcn     = p.shadcn ?? false

  return {
    name, recipe: 'custom', orm, db, packages, frameworks, primary, tailwind, shadcn,
    demos:   [],
    git:     p.git     ?? true,
    dbReady: p.dbReady ?? (db === 'sqlite'),
    install: p.install!,
  }
}
