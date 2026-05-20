/**
 * Lazy-load doctor checks from installed framework packages.
 *
 * Only invoked when `rudder doctor` runs — checks are useless outside the
 * doctor command, so paying the import cost on every CLI invocation would
 * be wasteful.
 *
 * Each contributing package exports a `<package>/doctor` subpath whose
 * import has the side effect of calling `registerDoctorCheck()` for its
 * rules. Adding a new contributing package: append to PACKAGES_WITH_CHECKS
 * AND ensure the package's `package.json#exports` declares the subpath.
 *
 * Resolution: imports resolve from `process.cwd()`, NOT from this file's
 * location. The cli doesn't declare these packages as dependencies — the
 * USER's app does, and pnpm's strict mode means cli's node_modules doesn't
 * see them. createRequire'ing from the user's package.json fixes that.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const PACKAGES_WITH_CHECKS: string[] = [
  // Phase 3 first wave — every package here ships a `<package>/doctor`
  // subpath whose side-effect import calls `registerDoctorCheck()` for its
  // rules. The dynamic import is `tryImport`-wrapped below, so packages not
  // installed in the user's app are silently skipped.
  '@rudderjs/auth', '@rudderjs/session', '@rudderjs/hash',
  '@rudderjs/orm-prisma', '@rudderjs/orm-drizzle',
  '@rudderjs/cashier-paddle',
  '@rudderjs/queue-bullmq', '@rudderjs/queue-inngest',
  '@rudderjs/ai', '@rudderjs/mcp',
  '@rudderjs/telescope', '@rudderjs/pulse', '@rudderjs/horizon',
]

export async function loadPackageChecks(): Promise<void> {
  // Resolve via direct path through the user's `node_modules/<pkg>/dist/doctor.js`,
  // not `import('<pkg>/doctor')` — the `./doctor` subpath only ships an `import`
  // condition (no `require`/`default`), which `createRequire().resolve()`
  // refuses to match. Walking the symlink/file path bypasses the conditional
  // exports machinery and works the same on pnpm (symlinked) and npm/yarn
  // (flat node_modules). Documented as the ESM-only-peer resolution workaround.
  await Promise.all(PACKAGES_WITH_CHECKS.map(async (pkg) => {
    try {
      const target = path.join(process.cwd(), 'node_modules', pkg, 'dist', 'doctor.js')
      if (!fs.existsSync(target)) return
      await import(/* @vite-ignore */ pathToFileURL(target).href)
    } catch {
      /* package not installed, or its doctor entry failed to load */
    }
  }))
}
