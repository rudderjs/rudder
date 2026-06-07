import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

interface SchemaModel {
  name: string
  fields: { name: string; type: string; modifiers: string }[]
}

/**
 * Read the database schema with a pure file-read posture — boost must never
 * boot the app or open a DB connection. Two sources, native-first:
 *
 * 1. `.rudder/types/models.d.ts` — the committed typed registry the native
 *    engine generates on `rudder migrate` / `schema:types` (native is the
 *    create-rudder default).
 * 2. `prisma/schema*` — the Prisma schema (single- or multi-file), for apps
 *    on the Prisma adapter.
 *
 * Both parse into the same `{ models, raw }` shape so the MCP tool's output
 * is stable across engines.
 */
export function getDbSchema(cwd: string): { models: SchemaModel[]; raw?: string } {
  const native = parseNativeRegistry(cwd)
  if (native) return native

  // Try multi-file prisma schema first (prisma/schema/*.prisma)
  const schemaDir = join(cwd, 'prisma', 'schema')
  const singleFile = join(cwd, 'prisma', 'schema.prisma')

  let content = '' // eslint-disable-line no-useless-assignment

  if (existsSync(schemaDir)) {
    const files = readdirSync(schemaDir).filter(f => f.endsWith('.prisma')).sort()
    content = files.map(f => readFileSync(join(schemaDir, f), 'utf8')).join('\n\n')
  } else if (existsSync(singleFile)) {
    content = readFileSync(singleFile, 'utf8')
  } else {
    return { models: [] }
  }

  return { models: parsePrismaModels(content), raw: content }
}

// ─── Native typed registry ─────────────────────────────────

/**
 * Parse the native engine's generated `SchemaRegistry` declaration. The file
 * has a rigid machine-generated shape (one table per `key: { … }` block, one
 * `name: type` line per column; keys are JSON-quoted only when they aren't
 * plain identifiers), so a line-walk is reliable without a TS parser.
 * Returns null when the registry doesn't exist — the caller falls back to
 * prisma parsing.
 */
export function parseNativeRegistry(cwd: string): { models: SchemaModel[]; raw: string } | null {
  const registryPath = join(cwd, '.rudder', 'types', 'models.d.ts')
  if (!existsSync(registryPath)) return null

  const content = readFileSync(registryPath, 'utf8')
  const start = content.indexOf('interface SchemaRegistry')
  if (start === -1) return null

  const models: SchemaModel[] = []
  let current: SchemaModel | null = null

  for (const line of content.slice(start).split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//')) continue

    // Table block opens: `users: {` or `"weird-name": {`
    const tableMatch = trimmed.match(/^(?:(\w+)|"((?:[^"\\]|\\.)*)"):\s*\{$/)
    if (tableMatch && current === null) {
      current = { name: tableMatch[1] ?? JSON.parse(`"${tableMatch[2]!}"`) as string, fields: [] }
      continue
    }

    if (current) {
      if (trimmed === '}') {
        models.push(current)
        current = null
        continue
      }
      // Column line: `email: string` / `read_at: string | null` / `"a b": number`
      const fieldMatch = trimmed.match(/^(?:(\w+)|"((?:[^"\\]|\\.)*)"):\s*(.+)$/)
      if (fieldMatch) {
        current.fields.push({
          name: fieldMatch[1] ?? JSON.parse(`"${fieldMatch[2]!}"`) as string,
          type: fieldMatch[3]!.trim(),
          modifiers: '',
        })
      }
    }
  }

  return { models, raw: content }
}

// ─── Prisma schema ─────────────────────────────────────────

function parsePrismaModels(content: string): SchemaModel[] {
  const models: SchemaModel[] = []
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g

  let match: RegExpExecArray | null
  while ((match = modelRegex.exec(content)) !== null) {
    const name = match[1]!
    const body = match[2]!
    const fields: SchemaModel['fields'] = []

    for (const line of body.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue

      // Match: fieldName Type modifiers
      const fieldMatch = trimmed.match(/^(\w+)\s+([\w?[\]]+)(.*)$/)
      if (fieldMatch) {
        fields.push({
          name: fieldMatch[1]!,
          type: fieldMatch[2]!,
          modifiers: fieldMatch[3]!.trim(),
        })
      }
    }

    models.push({ name, fields })
  }

  return models
}
