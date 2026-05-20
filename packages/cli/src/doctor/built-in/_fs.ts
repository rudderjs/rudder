import fs from 'node:fs'
import path from 'node:path'

/** True if `<cwd>/<rel>` exists and is a file. */
export function fileExists(rel: string): boolean {
  try {
    return fs.statSync(path.join(process.cwd(), rel)).isFile()
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
