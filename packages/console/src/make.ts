// ─── MakeSpec ─────────────────────────────────────────────

export interface MakeSpec {
  /** Commander command name, e.g. `make:controller` */
  command:     string
  /** Human description shown in help */
  description: string
  /** Label after the success checkmark, e.g. `Controller created` */
  label:       string
  /** Suffix appended to the class name if not already present */
  suffix?:     string
  /** Destination directory under the app root, e.g. `app/Http/Controllers` */
  directory:   string
  /**
   * File extension (no leading dot). Defaults to `ts`. Set `tsx` for stubs that
   * contain JSX (e.g. Ink terminal components) — a `.ts` file with JSX doesn't
   * compile.
   */
  extension?:  string
  /** Stub generator — receives the normalized class name */
  stub:        (className: string) => string
  /** Optional hook run after the file is created */
  afterCreate?: (className: string, relPath: string) => void
}

// ─── Global MakeSpec Registry ─────────────────────────────

const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_make_specs__']) _g['__rudderjs_make_specs__'] = [] as MakeSpec[]

const makeRegistry = _g['__rudderjs_make_specs__'] as MakeSpec[]

/** Register one or more MakeSpec entries (called by packages at import time or in boot). */
export function registerMakeSpecs(...specs: MakeSpec[]): void {
  for (const spec of specs) {
    if (!makeRegistry.some(s => s.command === spec.command)) {
      makeRegistry.push(spec)
    }
  }
}

/** Get all registered MakeSpec entries. */
export function getMakeSpecs(): readonly MakeSpec[] {
  return makeRegistry
}

// ─── Executor ─────────────────────────────────────────────

export interface MakeResult {
  created:   boolean
  relPath:   string
  className: string
}

/**
 * Execute a make spec — write the scaffolded file to disk.
 * Returns whether the file was created or already existed.
 */
export async function executeMakeSpec(
  spec: MakeSpec,
  name: string,
  opts: { force?: boolean },
): Promise<MakeResult> {
  // Lazy-load node: built-ins — top-level imports crash Vite's browser bundle
  const { writeFile, mkdir } = await import('node:fs/promises')
  const { resolve, dirname, sep } = await import('node:path')

  const className = spec.suffix && !name.endsWith(spec.suffix)
    ? `${name}${spec.suffix}`
    : name
  const relPath = `${spec.directory}/${className}.${spec.extension ?? 'ts'}`
  const outPath = resolve(process.cwd(), relPath)

  // Containment guard: the user-supplied name must not escape the spec's target
  // directory. Without this a name like `../../../etc/whatever` resolves outside
  // the app root and `mkdir({recursive})` would happily create the path, turning
  // a `make:*` invocation (e.g. from a codegen pipeline with an untrusted name)
  // into an arbitrary file write. Nested names like `Admin/User` stay allowed.
  const baseDir = resolve(process.cwd(), spec.directory)
  if (outPath !== baseDir && !outPath.startsWith(baseDir + sep)) {
    throw new Error(`Invalid name "${name}": the resolved path escapes ${spec.directory}.`)
  }

  await mkdir(dirname(outPath), { recursive: true })
  try {
    // Atomic create-or-overwrite: `wx` fails if the file exists, closing the
    // check-then-write race; `force` opts into truncating an existing file.
    await writeFile(outPath, spec.stub(className), { flag: opts.force ? 'w' : 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      return { created: false, relPath, className }
    }
    throw err
  }
  spec.afterCreate?.(className, relPath)

  return { created: true, relPath, className }
}
