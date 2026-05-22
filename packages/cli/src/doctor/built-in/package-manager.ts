import path from 'node:path'
import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'
import { fileExistsAtWorkspaceRoot, findWorkspaceRoot } from './_fs.js'

interface DetectedPM {
  /** PM inferred from the lockfile that exists in cwd. */
  fromLockfile: 'pnpm' | 'npm' | 'yarn' | 'bun' | null
  /** PM inferred from npm_config_user_agent — what the user actually ran. */
  fromUserAgent: 'pnpm' | 'npm' | 'yarn' | 'bun' | null
  /** Lockfiles found in cwd. */
  lockfiles: string[]
}

function detect(): DetectedPM {
  const lockMap: Array<[string, 'pnpm' | 'npm' | 'yarn' | 'bun']> = [
    ['pnpm-lock.yaml',     'pnpm'],
    ['package-lock.json',  'npm'],
    ['yarn.lock',          'yarn'],
    ['bun.lockb',          'bun'],
    ['bun.lock',           'bun'],
  ]
  const lockfiles = lockMap.filter(([f]) => fileExistsAtWorkspaceRoot(f)).map(([f]) => f)
  const fromLockfile = lockfiles.length === 1
    ? lockMap.find(([f]) => f === lockfiles[0])![1]
    : null

  const ua = process.env['npm_config_user_agent'] ?? ''
  const fromUserAgent: DetectedPM['fromUserAgent'] =
    ua.startsWith('pnpm') ? 'pnpm' :
    ua.startsWith('yarn') ? 'yarn' :
    ua.startsWith('bun')  ? 'bun' :
    ua.startsWith('npm')  ? 'npm' :
    null

  return { fromLockfile, fromUserAgent, lockfiles }
}

registerDoctorCheck({
  id:       'env:package-manager',
  category: 'env',
  title:    'Package manager',
  run(): DoctorResult {
    const d = detect()
    if (d.lockfiles.length === 0) {
      return {
        status:  'error',
        message: 'no lockfile found',
        fix:     'Run your package manager install (e.g. `pnpm install`, `npm install`, `yarn install`)',
      }
    }
    if (d.lockfiles.length > 1) {
      return {
        status:  'warn',
        message: `multiple lockfiles present: ${d.lockfiles.join(', ')}`,
        fix:     `Pick one PM and delete the others — mixed lockfiles cause flaky installs`,
      }
    }
    const pm = d.fromLockfile!
    const ua = d.fromUserAgent
    if (ua && ua !== pm) {
      return {
        status:  'warn',
        message: `lockfile is ${pm} but ran with ${ua}`,
        fix:     `Run with ${pm} (\`${pm} install\`, \`${pm} <script>\`) to match the lockfile`,
      }
    }
    const root = findWorkspaceRoot()
    const where = root === process.cwd()
      ? ''
      : ` (workspace root: ${path.relative(process.cwd(), root) || '.'})`
    return { status: 'ok', message: `${pm} — lockfile present${where}` }
  },
})
