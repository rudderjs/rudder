// Diagnostic plugin for rolldown/rolldown#9592.
//
// Question we're answering: does Vite 8 run rolldown more than once into the
// server outDir, and is the chunk carrying __VITE_ASSETS_MANIFEST__ emitted by
// the SAME rolldown build whose writeBundle runs Vike's set_macro, or by a
// DIFFERENT build sharing that outDir?
//
// Two modes, both opt-in:
//
//   DIAG_ASSETS_MANIFEST=1         NON-SUPPRESSING (use this in the reproducing
//                                  CI). Logs a build-identity timeline + scans
//                                  the WRITTEN outDir on disk. Reading the disk
//                                  does NOT collapse the bug (our shipped fix
//                                  already FS-walks); reading the in-memory
//                                  `bundle` DOES (a Heisenbug), so this mode
//                                  never touches `bundle`.
//
//   DIAG_ASSETS_MANIFEST=topology  SUPPRESSING (local understanding only). Also
//                                  enumerates the in-memory bundle in
//                                  generateBundle to show which chunk holds the
//                                  placeholder. Any in-hook bundle read makes the
//                                  bug vanish, so this is for mapping the happy
//                                  path, not for catching the failure.
//
// Off by default, so committing it and shipping to CI is a no-op until the env
// var is set. Logs to stderr with a [DIAG] prefix.
import type { Plugin } from 'vite'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Build the placeholder dynamically so this source file can never self-match if
// it ever lands in a scanned bundle.
const PLACEHOLDER = '__VITE_' + 'ASSETS_MANIFEST__'

// A monotonic pass counter on globalThis so it survives the per-environment
// module re-evaluation we observed (a plain module-level counter reset to 1 for
// each environment). Each buildStart = one rolldown invocation.
const g = globalThis as unknown as { __diagAM__?: { seq: number } }
g.__diagAM__ ??= { seq: 0 }

type Ctx = { environment?: { name?: string } }

export function diagAssetsManifest(): Plugin | false {
  const mode = process.env.DIAG_ASSETS_MANIFEST
  if (!mode) return false
  const topology = mode === 'topology'

  return {
    name: 'diag:assets-manifest',
    apply: 'build',
    // Run late so the on-disk scan reflects the final, set_macro-processed output.
    enforce: 'post',

    buildStart() {
      const env = (this as Ctx).environment?.name ?? '?'
      console.error(`[DIAG] buildStart   pass#${++g.__diagAM__!.seq}  env=${env}`)
    },

    // SUPPRESSING (topology mode only): which chunk holds the placeholder in the
    // in-memory bundle. Reading `bundle` here collapses the race, so off unless
    // explicitly mapping the happy path.
    generateBundle(options, bundle) {
      if (!topology) return
      const env = (this as Ctx).environment?.name ?? '?'
      const names = Object.keys(bundle)
      const placeholderChunks = names.filter((name) => {
        const item = bundle[name] as { type?: string; code?: string }
        return item?.type === 'chunk' && typeof item.code === 'string' && item.code.includes(PLACEHOLDER)
      })
      console.error(
        `[DIAG] generateBundle env=${env}  dir=${options.dir ?? '?'}  chunks=${names.length}  placeholderIn=${JSON.stringify(placeholderChunks)}`,
      )
    },

    // NON-SUPPRESSING: scan the written outDir on disk for any file that still
    // carries the placeholder. In the failing case this is non-empty (set_macro
    // missed it); on a clean build it's []. Combined with the buildStart timeline
    // this shows how many rolldown passes ran and into which outDirs.
    async writeBundle(options) {
      const env = (this as Ctx).environment?.name ?? '?'
      const dir = options.dir
      if (!dir) {
        console.error(`[DIAG] writeBundle   env=${env}  dir=?`)
        return
      }
      const placeholderOnDisk: string[] = []
      let jsFiles = 0
      try {
        const entries = await readdir(dir, { recursive: true })
        for (const entry of entries) {
          if (!(entry.endsWith('.js') || entry.endsWith('.mjs') || entry.endsWith('.cjs'))) continue
          jsFiles++
          let code: string
          try {
            code = await readFile(join(dir, entry), 'utf8')
          } catch {
            continue
          }
          if (code.includes(PLACEHOLDER)) placeholderOnDisk.push(entry)
        }
      } catch {
        // outDir absent (a build that emitted nothing) — nothing to report.
      }
      console.error(
        `[DIAG] writeBundle   env=${env}  dir=${dir}  jsFiles=${jsFiles}  placeholderOnDisk=${JSON.stringify(placeholderOnDisk)}`,
      )
    },
  }
}
