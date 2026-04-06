import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

// ─── Types ────────────────────────────────────────────────

export interface ProcessResult {
  /** Exit code (0 = success) */
  exitCode: number
  /** Combined stdout output */
  stdout: string
  /** Combined stderr output */
  stderr: string
  /** True if exit code is 0 */
  successful(): boolean
  /** True if exit code is not 0 */
  failed(): boolean
  /** Alias for stdout */
  output(): string
  /** Alias for stderr */
  errorOutput(): string
  /** Throws ProcessFailedException if the process failed, otherwise returns this */
  throw(): ProcessResult
}

export class ProcessFailedException extends Error {
  constructor(readonly result: ProcessResult) {
    super(
      `Process failed with exit code ${result.exitCode}.\n` +
      (result.stderr ? `stderr: ${result.stderr.slice(0, 500)}` : '')
    )
    this.name = 'ProcessFailedException'
  }
}

function makeResult(exitCode: number, stdout: string, stderr: string): ProcessResult {
  return {
    exitCode,
    stdout,
    stderr,
    successful() { return exitCode === 0 },
    failed()     { return exitCode !== 0 },
    output()     { return stdout },
    errorOutput() { return stderr },
    throw() {
      if (exitCode !== 0) throw new ProcessFailedException(this)
      return this
    },
  }
}

export interface RunningProcess {
  /** OS process ID */
  pid: number
  /** Check if the process is still running */
  running(): boolean
  /** Stdout collected so far */
  output(): string
  /** Stderr collected so far */
  errorOutput(): string
  /** Wait for the process to finish and return the result */
  wait(): Promise<ProcessResult>
  /** Kill the process */
  kill(signal?: NodeJS.Signals): void
}

export interface ProcessPoolResult {
  results: ProcessResult[]
  successful(): boolean
}

type OutputCallback = (type: 'stdout' | 'stderr', data: string) => void

// ─── PendingProcess ───────────────────────────────────────

export class PendingProcess {
  private _command:   string
  private _cwd?:      string
  private _timeout?:  number
  private _env?:      Record<string, string>
  private _input?:    string | Buffer
  private _quiet     = false
  private _tty       = false
  private _onOutput?: OutputCallback

  constructor(command: string) {
    this._command = command
  }

  path(directory: string): this { this._cwd = directory; return this }
  timeout(seconds: number): this { this._timeout = seconds * 1000; return this }
  env(vars: Record<string, string>): this { this._env = vars; return this }
  input(stdin: string | Buffer): this { this._input = stdin; return this }
  quietly(): this { this._quiet = true; return this }
  tty(): this { this._tty = true; return this }
  onOutput(fn: OutputCallback): this { this._onOutput = fn; return this }

  private buildOptions(): SpawnOptions & { shell: true } {
    return {
      shell:   true,
      cwd:     this._cwd,
      env:     this._env ? { ...process.env, ...this._env } : process.env,
      stdio:   this._tty ? 'inherit' : 'pipe',
    }
  }

  async run(): Promise<ProcessResult> {
    // Check fake first
    if (_fake) return _fake._run(this._command, this._input)

    const opts = this.buildOptions()
    const ac = this._timeout ? new AbortController() : undefined
    if (ac) (opts as unknown as Record<string, unknown>)['signal'] = ac.signal

    const timer = ac && this._timeout
      ? setTimeout(() => ac.abort(), this._timeout)
      : undefined

    return new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(this._command, [], opts)

      let stdout = ''
      let stderr = ''

      if (child.stdout) {
        child.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          stdout += text
          if (!this._quiet && this._onOutput) this._onOutput('stdout', text)
        })
      }

      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          stderr += text
          if (!this._quiet && this._onOutput) this._onOutput('stderr', text)
        })
      }

      if (this._input && child.stdin) {
        child.stdin.write(this._input)
        child.stdin.end()
      }

      child.on('error', (err) => {
        if (timer) clearTimeout(timer)
        if ((err as NodeJS.ErrnoException).code === 'ABORT_ERR') {
          resolve(makeResult(124, stdout, stderr + '\nProcess timed out'))
        } else {
          reject(err)
        }
      })

      child.on('close', (code) => {
        if (timer) clearTimeout(timer)
        resolve(makeResult(code ?? 1, stdout, stderr))
      })
    })
  }

  async start(): Promise<RunningProcess> {
    if (_fake) return _fake._start(this._command)

    const opts = this.buildOptions()
    const child = spawn(this._command, [], opts)

    let stdout = ''
    let stderr = ''
    let exited = false
    let exitCode = 0

    const waitPromise = new Promise<ProcessResult>((resolve, reject) => {
      if (child.stdout) {
        child.stdout.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          stdout += text
          if (!this._quiet && this._onOutput) this._onOutput('stdout', text)
        })
      }

      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString()
          stderr += text
          if (!this._quiet && this._onOutput) this._onOutput('stderr', text)
        })
      }

      if (this._input && child.stdin) {
        child.stdin.write(this._input)
        child.stdin.end()
      }

      child.on('error', reject)
      child.on('close', (code) => {
        exited = true
        exitCode = code ?? 1
        resolve(makeResult(exitCode, stdout, stderr))
      })
    })

    return {
      pid: child.pid ?? 0,
      running:     () => !exited,
      output:      () => stdout,
      errorOutput: () => stderr,
      wait:        () => waitPromise,
      kill:        (signal?: NodeJS.Signals) => child.kill(signal ?? 'SIGTERM'),
    }
  }
}

// ─── Fake ─────────────────────────────────────────────────

interface FakeResult {
  exitCode?: number
  stdout?: string
  stderr?: string
}

interface FakeRecord {
  command: string
  input: string | Buffer | undefined
}

export class FakeProcess {
  private _fakes   = new Map<string, FakeResult>()
  private _regexes: Array<{ pattern: RegExp; result: FakeResult }> = []
  private _ran: FakeRecord[] = []

  register(command: string | RegExp, result: FakeResult = {}): this {
    if (typeof command === 'string') {
      this._fakes.set(command, result)
    } else {
      this._regexes.push({ pattern: command, result })
    }
    return this
  }

  /** @internal */
  _run(command: string, input?: string | Buffer): ProcessResult {
    this._ran.push({ command, input })
    const result = this._match(command)
    return makeResult(
      result?.exitCode ?? 0,
      result?.stdout ?? '',
      result?.stderr ?? '',
    )
  }

  /** @internal */
  _start(command: string): RunningProcess {
    const result = this._run(command)
    return {
      pid: 0,
      running:     () => false,
      output:      () => result.stdout,
      errorOutput: () => result.stderr,
      wait:        () => Promise.resolve(result),
      kill:        () => {},
    }
  }

  private _match(command: string): FakeResult | undefined {
    const exact = this._fakes.get(command)
    if (exact) return exact
    for (const { pattern, result } of this._regexes) {
      if (pattern.test(command)) return result
    }
    return undefined
  }

  // ── Assertions ──────────────────────────────────────────

  assertRan(command: string | RegExp): void {
    const found = this._findRan(command)
    if (!found) {
      throw new Error(`Expected command "${String(command)}" to have been run, but it was not.`)
    }
  }

  assertNotRan(command: string | RegExp): void {
    const found = this._findRan(command)
    if (found) {
      throw new Error(`Expected command "${String(command)}" NOT to have been run, but it was.`)
    }
  }

  assertRanTimes(command: string | RegExp, count: number): void {
    const actual = this._countRan(command)
    if (actual !== count) {
      throw new Error(
        `Expected command "${String(command)}" to run ${count} time(s), but it ran ${actual} time(s).`
      )
    }
  }

  assertNothingRan(): void {
    if (this._ran.length > 0) {
      throw new Error(
        `Expected no commands to run, but ${this._ran.length} command(s) were run.`
      )
    }
  }

  private _findRan(command: string | RegExp): FakeRecord | undefined {
    return this._ran.find(r =>
      typeof command === 'string' ? r.command === command : command.test(r.command)
    )
  }

  private _countRan(command: string | RegExp): number {
    return this._ran.filter(r =>
      typeof command === 'string' ? r.command === command : command.test(r.command)
    ).length
  }

  restore(): void {
    _fake = null
  }
}

// ─── Global fake state ────────────────────────────────────

let _fake: FakeProcess | null = null

// ─── Process facade ───────────────────────────────────────

export class Process {
  static run(command: string): Promise<ProcessResult> {
    return new PendingProcess(command).run()
  }

  static command(command: string): PendingProcess {
    return new PendingProcess(command)
  }

  static start(command: string): Promise<RunningProcess> {
    return new PendingProcess(command).start()
  }

  static async pool(commands: string[]): Promise<ProcessPoolResult> {
    const results = await Promise.all(
      commands.map(cmd => new PendingProcess(cmd).run())
    )
    return {
      results,
      successful() { return results.every(r => r.successful()) },
    }
  }

  static async pipe(commands: string[]): Promise<ProcessResult> {
    if (commands.length === 0) return makeResult(0, '', '')

    let input: string | undefined
    let lastResult: ProcessResult = makeResult(0, '', '')

    for (const cmd of commands) {
      const pending = new PendingProcess(cmd)
      if (input !== undefined) pending.input(input)
      lastResult = await pending.run()
      if (lastResult.failed()) return lastResult
      input = lastResult.stdout
    }

    return lastResult
  }

  static fake(fakes?: Record<string, FakeResult>): FakeProcess {
    const fake = new FakeProcess()
    if (fakes) {
      for (const [cmd, result] of Object.entries(fakes)) {
        fake.register(cmd, result)
      }
    }
    _fake = fake
    return fake
  }
}
