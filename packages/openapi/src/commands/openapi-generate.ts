import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { generateOpenApiDocument } from '../emitter.js'
import { resolveDocInfo } from '../doc-info.js'
import { toYaml } from '../yaml.js'
import type { RouterLike } from '../types.js'

interface Rudder {
  command(name: string, handler: (args: string[]) => void | Promise<void>): { description(text: string): unknown }
}

/** Parse `--flag=value` (or `--flag value`) out of the raw arg list. */
function flagValue(args: string[], name: string): string | undefined {
  const eq = args.find(a => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const idx = args.indexOf(`--${name}`)
  if (idx !== -1 && args[idx + 1] && !args[idx + 1]!.startsWith('-')) return args[idx + 1]
  return undefined
}

/**
 * Register `openapi:generate [--out=openapi.json] [--yaml]`.
 *
 * The app is already booted by the CLI (this command is NOT in the skip-boot
 * list), so the route table is fully registered. We read it via `router.list()`
 * — same source as `route:list` — and write the spec to disk.
 */
export function registerOpenApiGenerateCommand(rudder: Rudder): void {
  rudder.command('openapi:generate', async (args: string[]) => {
    let router: RouterLike | undefined
    try {
      const mod = await import('@rudderjs/router') as { router?: RouterLike }
      router = mod.router
    } catch {
      console.error('[openapi] @rudderjs/router is not installed — nothing to introspect.')
      process.exitCode = 1
      return
    }
    if (!router || typeof router.list !== 'function') {
      console.error('[openapi] router has no route table (is the app booted?).')
      process.exitCode = 1
      return
    }

    const yaml = args.includes('--yaml')
    const out  = flagValue(args, 'out') ?? (yaml ? 'openapi.yaml' : 'openapi.json')
    const outPath = path.isAbsolute(out) ? out : path.join(process.cwd(), out)

    const warnings: string[] = []
    const info = await resolveDocInfo({ onWarn: (m) => warnings.push(m) })
    const doc = generateOpenApiDocument(router, info)

    const serialized = yaml ? toYaml(doc) : `${JSON.stringify(doc, null, 2)}\n`
    await writeFile(outPath, serialized, 'utf8')

    const pathCount = Object.keys(doc.paths).length
    for (const w of warnings) console.warn(`  \x1b[33m⚠\x1b[0m ${w}`)
    console.log(`\x1b[32m✓\x1b[0m OpenAPI ${doc.openapi} spec written to ${path.relative(process.cwd(), outPath)} (${pathCount} path${pathCount === 1 ? '' : 's'})`)
  }).description('Generate an OpenAPI 3.1 spec from the route table (--out=<file>, --yaml)')
}
