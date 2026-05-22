import { execSync } from 'node:child_process'

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

/** Detect which package manager invoked the installer.
 *  1. Check npm_config_user_agent (set by pnpm/npm/yarn/bun create commands)
 *  2. Fall back to checking which binaries are available on PATH
 */
export function detectPackageManager(): PackageManager {
  const ua = process.env['npm_config_user_agent'] ?? ''
  if (ua.startsWith('bun'))  return 'bun'
  if (ua.startsWith('yarn')) return 'yarn'
  if (ua.startsWith('pnpm')) return 'pnpm'
  if (ua.startsWith('npm'))  return 'npm'

  // Fallback: check which binaries exist on PATH (preference: pnpm > bun > yarn > npm)
  for (const pm of ['pnpm', 'bun', 'yarn'] as const) {
    try {
      execSync(`${pm} --version`, { stdio: 'ignore' })
      return pm
    } catch { /* not found */ }
  }
  return 'npm'
}

/** `<pm> exec <bin>` equivalent per package manager. */
export function pmExec(pm: PackageManager, bin: string): string {
  if (pm === 'bun')  return `bunx ${bin}`
  if (pm === 'yarn') return `yarn dlx ${bin}`
  if (pm === 'npm')  return `npx ${bin}`
  return `pnpm exec ${bin}`
}

/** `<pm> run <script>` equivalent (yarn/bun allow omitting "run"). */
export function pmRun(pm: PackageManager, script: string): string {
  if (pm === 'npm') return `npm run ${script}`
  return `${pm} ${script}`
}

/** `<pm> install` command. */
export function pmInstall(pm: PackageManager): string {
  return `${pm} install`
}

export function pageExt(fw: 'react' | 'vue' | 'solid'): '.tsx' | '.vue' {
  return fw === 'vue' ? '.vue' : '.tsx'
}
