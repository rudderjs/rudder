import type { Command } from 'commander'
import { CliError } from '@rudderjs/console'
import { registerMake } from './_shared.js'

/** Parse + validate the `--status` flag; defaults to 500. */
export function resolveStatus(opts: Record<string, unknown>): number {
  if (opts['status'] === undefined) return 500
  const status = Number(opts['status'])
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new CliError(`--status must be an HTTP error status between 400 and 599, got "${opts['status']}"`)
  }
  return status
}

export function stub(className: string, status: number): string {
  return `/**
 * ${className} — a typed domain exception.
 *
 * The \`httpStatus\` property opts into the framework's duck-typed rendering:
 * thrown from a route, the response uses this status automatically (JSON for
 * API requests, HTML for browser navigations) — no registration required.
 *
 * Need a custom response shape? Register a renderer in bootstrap/app.ts:
 *
 *   .withExceptions((e) => {
 *     e.render(${className}, (err, req) =>
 *       Response.json({ message: err.message }, { status: err.httpStatus }),
 *     )
 *   })
 */
export class ${className} extends Error {
  /** Rendered with this HTTP status by the framework's exception pipeline. */
  readonly httpStatus = ${status}

  constructor(message: string) {
    super(message)
    this.name = '${className}'
  }
}
`
}

export function makeException(program: Command): void {
  registerMake(program, {
    command:     'make:exception',
    description: 'Create a new exception class',
    label:       'Exception created',
    directory:   'app/Exceptions',
    testKind:    'unit',
    stub:        (className, opts) => stub(className, resolveStatus(opts)),
    extraOptions: [
      { flags: '-s, --status <code>', description: 'HTTP status the exception renders with (4xx/5xx, default 500)' },
    ],
  })
}
