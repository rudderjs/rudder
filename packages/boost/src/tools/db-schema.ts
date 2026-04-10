import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

interface PrismaModel {
  name: string
  fields: { name: string; type: string; modifiers: string }[]
}

export function getDbSchema(cwd: string): { models: PrismaModel[]; raw?: string } {
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

function parsePrismaModels(content: string): PrismaModel[] {
  const models: PrismaModel[] = []
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g

  let match: RegExpExecArray | null
  while ((match = modelRegex.exec(content)) !== null) {
    const name = match[1]!
    const body = match[2]!
    const fields: PrismaModel['fields'] = []

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
