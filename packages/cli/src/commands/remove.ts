import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { Command } from 'commander'
import { _internal } from './add.js'

const { REGISTRY, findSpec, detectPackageManager } = _internal

// ── Package manager remove command ───────────────────────────

type PackageManager = ReturnType<typeof detectPackageManager>

function pmRemove(pm: PackageManager, dep: string): string[] {
  switch (pm) {
    case 'pnpm': return ['remove', dep]
    case 'npm':  return ['uninstall', dep]
    case 'yarn': return ['remove', dep]
    case 'bun':  return ['remove', dep]
  }
}

// ── Helpers ──────────────────────────────────────────────────

function isInstalled(cwd: string, npmName: string): boolean {
  const pkgPath = path.join(cwd, 'package.json')
  if (!existsSync(pkgPath)) return false
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>; devDependencies?: Record<string, string>
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  return npmName in deps
}

/**
 * Walk the registry and return the aliases of packages that:
 *   1. Are currently installed, AND
 *   2. List `alias` in their `requires` array.
 *
 * Used to refuse a remove that would leave dependent packages in a broken
 * state (e.g. `rudder remove auth` while sanctum/passport are still
 * installed would crash both providers at boot).
 */
export function findInstalledDependents(cwd: string, alias: string): string[] {
  return REGISTRY
    .filter(spec => spec.requires?.includes(alias))
    .filter(spec => isInstalled(cwd, spec.npmName))
    .map(spec => spec.alias)
}

// ── config/index.ts surgical un-register ─────────────────────

/**
 * Remove the `import <key> from './<key>.js'` line + the `<key>` entry in
 * the `const configs = { ... }` object. Mirror of `registerConfigKey` in
 * add.ts. Idempotent — bails cleanly if the key isn't currently registered.
 *
 * Returns `'ok' | 'not-registered' | 'unrecognized-shape'`.
 */
export function unregisterConfigKey(indexPath: string, key: string): 'ok' | 'not-registered' | 'unrecognized-shape' {
  const src = readFileSync(indexPath, 'utf8')

  // Find the import line for this key.
  // Match: optional leading newline, `import <key>` (any whitespace), `from './<key>.js'`, trailing newline.
  const importLineRe = new RegExp(`\\n?import\\s+${key}\\s+from\\s+'\\./${key}\\.js'\\s*\\n?`)
  const importMatch  = importLineRe.exec(src)
  if (!importMatch) return 'not-registered'

  // Find the configs block.
  const configsRe = /const\s+configs\s*=\s*\{([^}]*)\}/
  const configsMatch = configsRe.exec(src)
  if (!configsMatch) return 'unrecognized-shape'

  // Strip the key from the configs object literal.
  const keys = configsMatch[1]!.split(',').map(s => s.trim()).filter(Boolean)
  if (!keys.includes(key)) return 'unrecognized-shape'  // import present but key absent — manual edit, bail
  const remainingKeys = keys.filter(k => k !== key)

  // Splice both edits. Apply the configs replacement first (further right in
  // the file) so its offset stays stable while we then drop the import line.
  let out = src.slice(0, configsMatch.index)
    + `const configs = { ${remainingKeys.join(', ')} }`
    + src.slice(configsMatch.index + configsMatch[0].length)

  // Re-run the import regex on the mutated string — offsets shifted.
  const newImportMatch = importLineRe.exec(out)
  if (newImportMatch) {
    // Preserve a single newline at the seam so the surrounding imports still
    // form a contiguous block with no double blank lines.
    const replacement = newImportMatch[0]!.startsWith('\n') && newImportMatch[0]!.endsWith('\n') ? '\n' : ''
    out = out.slice(0, newImportMatch.index) + replacement + out.slice(newImportMatch.index + newImportMatch[0].length)
  }

  writeFileSync(indexPath, out)
  return 'ok'
}

// ── Child-process runner ──────────────────────────────────────

function runChild(cmd: string, args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: false })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
  })
}

// ── Command ───────────────────────────────────────────────────

export function removeCommand(program: Command): void {
  program
    .command('remove <package>')
    .description('Uninstall a RudderJS package — reverses `rudder add` (removes dep, config file, and unregisters)')
    .option('--keep-config', 'Leave config/<name>.ts and the config/index.ts entry in place')
    .action(async (packageName: string, opts: { keepConfig?: boolean }) => {
      const cwd  = process.cwd()
      const spec = findSpec(packageName)
      if (!spec) {
        const valid = REGISTRY.map(p => p.alias).join(', ')
        console.error(`[rudder remove] Unknown package "${packageName}".\n  Available: ${valid}`)
        process.exit(1)
      }

      // Idempotency — already gone?
      if (!isInstalled(cwd, spec.npmName)) {
        console.log(`  ${spec.npmName} is not installed — nothing to remove.`)
        // Still try to clean any leftover config files (e.g. config wired but
        // dep already removed by hand). Surfaces inconsistent state.
        if (!opts.keepConfig && spec.config) {
          const configFile = path.join(cwd, 'config', `${spec.config.key}.ts`)
          const indexFile  = path.join(cwd, 'config', 'index.ts')
          if (existsSync(configFile)) {
            unlinkSync(configFile)
            console.log(`  Cleaned up orphaned config/${spec.config.key}.ts`)
          }
          if (existsSync(indexFile)) {
            const result = unregisterConfigKey(indexFile, spec.config.key)
            if (result === 'ok') console.log(`  Cleaned up orphaned entry in config/index.ts`)
          }
        }
        return
      }

      // Refuse if other installed packages depend on this one.
      const dependents = findInstalledDependents(cwd, spec.alias)
      if (dependents.length > 0) {
        console.error(`[rudder remove] Cannot remove ${spec.alias} — these installed packages depend on it: ${dependents.join(', ')}`)
        console.error(`  Remove them first, or keep ${spec.alias} installed.`)
        process.exit(1)
      }

      const pm = detectPackageManager()

      // 1. Uninstall the dependency
      console.log(`\n  Removing ${spec.npmName}...`)
      const ok = await runChild(pm, pmRemove(pm, spec.npmName), cwd)
      if (!ok) {
        console.error(`[rudder remove] ${pm} ${pmRemove(pm, spec.npmName).join(' ')} failed.`)
        process.exit(1)
      }

      // 2. Delete config file (unless --keep-config)
      if (!opts.keepConfig && spec.config) {
        const configFile = path.join(cwd, 'config', `${spec.config.key}.ts`)
        if (existsSync(configFile)) {
          unlinkSync(configFile)
          console.log(`  Deleted config/${spec.config.key}.ts`)
        }

        // 3. Unregister from config/index.ts
        const indexFile = path.join(cwd, 'config', 'index.ts')
        if (existsSync(indexFile)) {
          const result = unregisterConfigKey(indexFile, spec.config.key)
          if (result === 'ok') {
            console.log(`  Unregistered "${spec.config.key}" in config/index.ts`)
          } else if (result === 'unrecognized-shape') {
            console.warn(`  ⚠ Could not auto-edit config/index.ts (custom shape).`)
            console.warn(`    Remove manually: the import line and key for "${spec.config.key}".`)
          }
          // 'not-registered' is silent — nothing to do.
        }
      }

      // 4. Refresh provider manifest so the freshly-removed provider drops out.
      console.log(`  Refreshing provider manifest...`)
      const discoverOk = await runChild(pm, [...(pm === 'npm' ? ['exec'] : []), 'rudder', 'providers:discover'], cwd)
      if (!discoverOk) {
        console.warn(`  ⚠ providers:discover failed — run \`${pm} rudder providers:discover\` manually.`)
      }

      console.log()
      console.log(`  ✓ ${spec.alias} removed.`)
    })
}

// ── Test exports ──────────────────────────────────────────────
export const _testInternal = { findInstalledDependents }
