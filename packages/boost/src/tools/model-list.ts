import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, basename, relative } from 'node:path'
import { parseNativeRegistry } from './db-schema.js'

interface ModelInfo {
  name: string
  file: string
  table: string | null
  fields: string[]
}

/**
 * List ORM models under `app/Models/**` (recursive — apps namespace models in
 * subdirectories). Fields come from hand-declared `prop!: type` lines; models
 * bound via `Model.for<'table'>()` declare no fields in-file, so their columns
 * are resolved from the native typed registry (`.rudder/types/models.d.ts`)
 * when it exists. Pure file-read posture — never boots the app.
 */
export function getModelList(cwd: string): ModelInfo[] {
  const models: ModelInfo[] = []

  const modelsDir = join(cwd, 'app', 'Models')
  if (!existsSync(modelsDir)) return models

  // Lazy: only parsed when a Model.for<>() model with no declared fields shows up.
  let registry: Map<string, string[]> | null | undefined

  for (const filePath of walkModelFiles(modelsDir)) {
    const file = basename(filePath)
    const content = readFileSync(filePath, 'utf8')
    const name = basename(file, file.endsWith('.ts') ? '.ts' : '.js')

    // Extract table name — `static table = 'posts'`, or the registry binding
    // generic `Model.for<'posts'>()` when no static is declared.
    const tableMatch = content.match(/static\s+(?:override\s+)?table\s*=\s*['"`](\w+)['"`]/)
    const forMatch = content.match(/Model\.for<\s*['"`](\w+)['"`]\s*>\s*\(\)/)
    const table = tableMatch?.[1] ?? forMatch?.[1] ?? null

    // Extract fields (property declarations with !)
    const fields: string[] = []
    const fieldRegex = /(\w+)!\s*:\s*([^\n;]+)/g
    let match: RegExpExecArray | null
    while ((match = fieldRegex.exec(content)) !== null) {
      fields.push(`${match[1]}: ${match[2]!.trim()}`)
    }

    // Model.for<'table'>() models carry no in-file declarations — their columns
    // live in the generated registry. Resolve them from there.
    if (fields.length === 0 && forMatch && table) {
      if (registry === undefined) registry = loadRegistryFields(cwd)  // null = no registry; don't re-probe
      const columns = registry?.get(table)
      if (columns) fields.push(...columns)
    }

    models.push({
      name,
      file: join('app', 'Models', relative(modelsDir, filePath)).split('\\').join('/'),
      table,
      fields,
    })
  }

  return models
}

/** Recursively collect model source files, skipping declaration files and
 *  generated/declaration-only directories. */
function walkModelFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue
      out.push(...walkModelFiles(join(dir, entry.name)))
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.js')
    ) {
      out.push(join(dir, entry.name))
    }
  }
  return out
}

/** `table → ["col: type", …]` from the native typed registry, or null when
 *  the app has none (e.g. the Prisma adapter). */
function loadRegistryFields(cwd: string): Map<string, string[]> | null {
  const parsed = parseNativeRegistry(cwd)
  if (!parsed) return null
  const map = new Map<string, string[]>()
  for (const model of parsed.models) {
    map.set(model.name, model.fields.map(f => `${f.name}: ${f.type}`))
  }
  return map
}
