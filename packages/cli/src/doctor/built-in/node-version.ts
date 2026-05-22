import { registerDoctorCheck, type DoctorResult } from '@rudderjs/console'
import { readJsonSafe } from './_fs.js'

/**
 * Loose semver `Major.Minor.Patch` parser — good enough to compare against a
 * package.json `engines.node` range like `^20.19.0 || >=22.12.0`.
 *
 * We don't pull in `semver` because the CLI ships with the framework and
 * pulling a 3rd-party parser for one comparison is wasteful. The range syntax
 * we accept matches what create-rudder generates.
 */
function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

function cmp(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const ai = a[i]!, bi = b[i]!
    if (ai !== bi) return ai - bi
  }
  return 0
}

function matchesRange(version: [number, number, number], range: string): boolean {
  // Handle `||` alternation
  return range.split('||').some(part => matchesSingle(version, part.trim()))
}

function matchesSingle(version: [number, number, number], range: string): boolean {
  // ^X.Y.Z — same major, >= X.Y.Z
  let m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range)
  if (m) {
    const target: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return version[0] === target[0] && cmp(version, target) >= 0
  }
  // >=X.Y.Z
  m = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range)
  if (m) {
    const target: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return cmp(version, target) >= 0
  }
  // Exact `X.Y.Z`
  m = /^=?\s*(\d+)\.(\d+)\.(\d+)$/.exec(range)
  if (m) {
    const target: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return cmp(version, target) === 0
  }
  return false
}

registerDoctorCheck({
  id:       'env:node-version',
  category: 'env',
  title:    'Node version',
  run(): DoctorResult {
    const pkg = readJsonSafe<{ engines?: { node?: string } }>('package.json')
    const range = pkg?.engines?.node
    const current = parseVersion(process.version)
    if (!current) {
      return { status: 'warn', message: `couldn't parse Node version "${process.version}"` }
    }
    if (!range) {
      return { status: 'ok', message: `${process.version} (no engines.node constraint)` }
    }
    if (matchesRange(current, range)) {
      return { status: 'ok', message: `${process.version} (matches ${range})` }
    }
    return {
      status:  'error',
      message: `${process.version} does not satisfy ${range}`,
      fix:     `Install a Node version matching ${range} (use \`nvm install\`, fnm, or asdf)`,
    }
  },
})
