import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export function getAppInfo(cwd: string): Record<string, unknown> {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return { error: 'No package.json found' }

  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
  } catch (err) {
    return { error: `Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}` }
  }
  const deps = { ...(pkg['dependencies'] as Record<string, string> ?? {}), ...(pkg['devDependencies'] as Record<string, string> ?? {}) }

  const rudderPkgs = Object.entries(deps)
    .filter(([name]) => name.startsWith('@rudderjs/'))
    .map(([name, version]) => ({ name, version }))

  return {
    name: pkg['name'] ?? 'unknown',
    version: pkg['version'] ?? '0.0.0',
    node: process.version,
    packageManager: detectPM(cwd),
    rudderPackages: rudderPkgs,
    totalDependencies: Object.keys(deps).length,
  }
}

function detectPM(cwd: string): string {
  const dirs = [cwd, join(cwd, '..')]
  for (const dir of dirs) {
    if (existsSync(join(dir, 'pnpm-lock.yaml')) || existsSync(join(dir, 'pnpm-workspace.yaml'))) return 'pnpm'
    if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
    if (existsSync(join(dir, 'bun.lockb'))) return 'bun'
  }
  return 'npm'
}
