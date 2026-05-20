/**
 * Lazy-load doctor checks from installed framework packages.
 *
 * Mirrors `loadPackageCommands()` in shape (hardcoded list + try-catch
 * dynamic imports) but is only invoked when `rudder doctor` runs — checks
 * are useless outside the doctor command, so paying the import cost on
 * every CLI invocation would be wasteful.
 *
 * Each contributing package exports a `<package>/doctor` subpath whose
 * import has the side effect of calling `registerDoctorCheck()` for its
 * rules. Adding a new contributing package: append to PACKAGES_WITH_CHECKS
 * AND ensure the package's `package.json#exports` declares the subpath.
 */
const PACKAGES_WITH_CHECKS: string[] = [
  // Phase 3 will populate this list as packages ship doctor.ts subpaths.
  // Examples for the first wave:
  // '@rudderjs/auth', '@rudderjs/session', '@rudderjs/hash',
  // '@rudderjs/orm-prisma', '@rudderjs/orm-drizzle',
  // '@rudderjs/cashier-paddle',
  // '@rudderjs/queue', '@rudderjs/queue-bullmq', '@rudderjs/queue-inngest',
  // '@rudderjs/broadcast', '@rudderjs/sync',
  // '@rudderjs/ai', '@rudderjs/mcp',
  // '@rudderjs/telescope', '@rudderjs/pulse', '@rudderjs/horizon',
]

export async function loadPackageChecks(): Promise<void> {
  await Promise.all(PACKAGES_WITH_CHECKS.map(async (pkg) => {
    try {
      // `/* @vite-ignore */` per the existing `loadPackageCommands` pattern —
      // these subpaths are optional and may not be installed.
      await import(/* @vite-ignore */ `${pkg}/doctor`)
    } catch {
      /* package not installed or doesn't ship doctor checks */
    }
  }))
}
