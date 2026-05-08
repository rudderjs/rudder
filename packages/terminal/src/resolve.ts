import path from 'node:path'
import fs from 'node:fs/promises'
import type { ComponentType } from 'react'

const EXTENSIONS = ['.tsx', '.ts', '.js', '.mjs']

/**
 * Convert a dot-notation terminal id to a relative file path (no extension).
 * 'dashboard'       → 'app/Terminal/Dashboard'
 * 'admin.users'     → 'app/Terminal/Admin/Users'
 */
export function idToPath(id: string): string {
  const segments = id
    .split('.')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
  return path.join('app', 'Terminal', ...segments)
}

/**
 * Resolve a terminal component by id.
 * Tries each extension in order; throws a clear error if not found.
 */
export async function resolveComponent(
  id: string,
  appRoot = process.cwd(),
): Promise<ComponentType<Record<string, unknown>>> {
  const rel = idToPath(id)

  for (const ext of EXTENSIONS) {
    const fullPath = path.join(appRoot, rel + ext)
    try {
      await fs.access(fullPath)
      const mod = await import(/* @vite-ignore */ fullPath) as {
        default?: ComponentType<Record<string, unknown>>
      }
      if (!mod.default) {
        throw new Error(
          `Terminal component "${id}" (${fullPath}) has no default export. ` +
          `Export a React component as the default export.`,
        )
      }
      return mod.default
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw e
    }
  }

  throw new Error(
    `Terminal component "${id}" not found. ` +
    `Expected file at: ${path.join(appRoot, rel)}.{tsx,ts,js}`,
  )
}
