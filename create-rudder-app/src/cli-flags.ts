import type { TemplateContext } from './templates.js'
import { availableDemos, DEMOS } from './templates/demos/registry.js'

export type Frameworks = ('react' | 'vue' | 'solid')[]
export type Orm        = 'prisma' | 'drizzle' | false
export type Db         = 'sqlite' | 'postgresql' | 'mysql'

export interface Answers {
  name:       string
  orm:        Orm
  db:         Db
  packages:   TemplateContext['packages']
  frameworks: Frameworks
  primary:    'react' | 'vue' | 'solid'
  tailwind:   boolean
  shadcn:     boolean
  demos:      string[]
  install:    boolean
}

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
  if (flags['demos'] !== undefined) {
    const list = flags['demos'].split(',').map(s => s.trim()).filter(Boolean)
    if (list.includes('*')) {
      partial.demos = ['*']
    } else {
      const valid = new Set(DEMOS.map(d => d.value))
      for (const d of list) {
        if (!valid.has(d)) throw new FlagError(`--demos: unknown demo "${d}". Valid: ${[...valid].join(', ')}`)
      }
      partial.demos = list
    }
  }

  return {
    name,
    partial,
    jsonRequested:    bools['json'] ?? false,
    forceInteractive: bools['interactive'] ?? false,
  }
}

export function validateJsonMode(name: string | undefined, p: PartialAnswers): string[] {
  const missing: string[] = []
  if (!name) missing.push('<project-name>')
  if (p.orm === undefined)        missing.push('--orm')
  if (p.orm !== false && !p.db)   missing.push('--db')
  if (p.packages === undefined)   missing.push('--packages')
  if (!p.frameworks)              missing.push('--frameworks')
  if (p.frameworks && p.frameworks.length > 1 && !p.primary) missing.push('--primary-framework')
  if (p.tailwind === undefined)   missing.push('--tailwind')
  if (p.frameworks?.includes('react') && p.tailwind === true && p.shadcn === undefined) {
    missing.push('--shadcn')
  }
  if (p.demos === undefined)      missing.push('--demos')
  if (p.install === undefined)    missing.push('--install')
  return missing
}

export function resolveJsonAnswers(name: string, p: PartialAnswers): Answers {
  const orm        = p.orm!
  const db         = (orm === false ? 'sqlite' : p.db!) as Db
  const packages   = p.packages!
  const frameworks = p.frameworks!
  const primary    = p.primary ?? frameworks[0]!
  const tailwind   = p.tailwind!
  const shadcn     = p.shadcn ?? false

  let demos: string[] = []
  if (p.demos) {
    if (p.demos.includes('*')) {
      demos = primary === 'react' ? availableDemos(orm, packages).map(d => d.value) : []
    } else {
      demos = p.demos
    }
  }

  return { name, orm, db, packages, frameworks, primary, tailwind, shadcn, demos, install: p.install! }
}
