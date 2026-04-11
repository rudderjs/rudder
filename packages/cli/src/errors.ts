/**
 * Error thrown by CLI helpers when they need to abort with a specific
 * exit code and a clean (no stack trace) message. The top-level handler
 * in `index.ts` recognises this and exits accordingly.
 */
export class CliError extends Error {
  constructor(message: string, readonly exitCode: number = 1) {
    super(message)
    this.name = 'CliError'
  }
}
