import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function getAbsoluteUrl(cwd: string, path: string): Promise<string> {
  let appUrl = 'http://localhost:3000'

  const envPath = join(cwd, '.env')
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8')
    const match = content.match(/^APP_URL\s*=\s*(.+)$/m)
    if (match?.[1]) {
      appUrl = match[1].trim().replace(/^['"]|['"]$/g, '')
    }
  }

  // Remove trailing slash from base, ensure path starts with /
  const base = appUrl.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return Promise.resolve(new URL(normalizedPath, base).toString())
}
