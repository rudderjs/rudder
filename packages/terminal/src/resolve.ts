import path from 'node:path'
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { ComponentType } from 'react'

/**
 * Candidate extensions tried in order — stop at first match.
 *
 * Order is deliberate: `.tsx` and `.ts` come first because Ink components
 * are almost always written in TypeScript (IDE support, prop typing).
 * `.js` and `.mjs` exist for runtime-only commands (rare). Future
 * additions (`.cts`, `.mts`) should be placed after their non-`c`/`m`
 * counterparts so the existing precedence isn't disturbed.
 */
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
  // POSIX separators — id-to-path is part of the public API and must
  // be platform-stable. fs.access / dynamic import accept mixed slashes
  // on Windows, so downstream code keeps working.
  return path.posix.join('app', 'Terminal', ...segments)
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
    } catch (e) {
      // Only "no file for this extension" should advance to the next candidate.
      // Any other access error (EACCES, etc.) is real — surface it.
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw e
    }

    // The file exists. From here, errors must propagate unchanged — including
    // an ENOENT thrown by the component's OWN module-level code (e.g. a missing
    // file it reads at import time). Catching it here would misreport a real
    // failure as "component not found", hiding the user's actual bug.
    // Node's ESM loader requires file:// URLs for absolute paths on Windows.
    const mod = await import(/* @vite-ignore */ pathToFileURL(fullPath).href) as {
      default?: ComponentType<Record<string, unknown>>
    }
    if (!mod.default) {
      throw new Error(
        `Terminal component "${id}" (${toPosix(fullPath)}) has no default export. ` +
        `Export a React component as the default export.`,
      )
    }
    return mod.default
  }

  throw new Error(
    `Terminal component "${id}" not found. ` +
    `Expected file at: ${toPosix(path.join(appRoot, rel))}.{${EXTENSIONS.map(e => e.slice(1)).join(',')}}`,
  )
}

const toPosix = (p: string) => p.split(path.sep).join('/')
