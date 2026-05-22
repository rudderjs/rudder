import fs from 'node:fs'
import path from 'node:path'

/**
 * Walk up from `start` looking for a marker that identifies a repo or
 * workspace root. Returns the directory containing the marker, or `start`
 * when no marker is found (filesystem root reached).
 *
 * Used so checks like `env:package-manager` can find a lockfile that lives
 * at the workspace root even when doctor runs inside a sub-package.
 */
export function findWorkspaceRoot(start: string = process.cwd()): string {
  const markers = ['pnpm-workspace.yaml', 'lerna.json', '.git']
  let dir = start
  while (true) {
    for (const m of markers) {
      try {
        fs.statSync(path.join(dir, m))
        return dir
      } catch { /* keep looking */ }
    }
    // npm / yarn / bun workspaces declare a "workspaces" field on root package.json
    try {
      const pkgText = fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')
      const pkg     = JSON.parse(pkgText) as { workspaces?: unknown }
      if (pkg.workspaces !== undefined) return dir
    } catch { /* keep looking */ }

    const parent = path.dirname(dir)
    if (parent === dir) return start  // hit filesystem root → fall back to cwd
    dir = parent
  }
}

/** True if `<cwd>/<rel>` exists and is a file. */
export function fileExists(rel: string): boolean {
  try {
    return fs.statSync(path.join(process.cwd(), rel)).isFile()
  } catch {
    return false
  }
}

/** True if `<workspaceRoot>/<rel>` exists and is a file. */
export function fileExistsAtWorkspaceRoot(rel: string): boolean {
  try {
    return fs.statSync(path.join(findWorkspaceRoot(), rel)).isFile()
  } catch {
    return false
  }
}

/** Read `<cwd>/<rel>` as a UTF-8 string. Returns null on any error. */
export function readFileSafe(rel: string): string | null {
  try {
    return fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
  } catch {
    return null
  }
}

/** `fs.stat(<cwd>/<rel>).mtimeMs` or null on error. */
export function mtimeMs(rel: string): number | null {
  try {
    return fs.statSync(path.join(process.cwd(), rel)).mtimeMs
  } catch {
    return null
  }
}

/** True if any of the given relative paths exists (file or dir). */
export function anyExists(rels: string[]): boolean {
  for (const rel of rels) {
    try {
      fs.statSync(path.join(process.cwd(), rel))
      return true
    } catch { /* keep looking */ }
  }
  return false
}

/** Read JSON file at `<cwd>/<rel>` or null on error. */
export function readJsonSafe<T = unknown>(rel: string): T | null {
  const text = readFileSafe(rel)
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
