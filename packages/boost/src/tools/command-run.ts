import { spawn } from 'node:child_process'
import { detectPackageManager, rudderArgv } from './_pm.js'

export interface CommandRunResult {
  stdout:     string
  stderr:     string
  exitCode:   number
  durationMs: number
  killed:     boolean
}

const STREAM_CAP_BYTES = 1_000_000  // 1 MB per stream — agents truncate huge outputs anyway

/**
 * Execute `<pm> rudder <name> <...args>` as a subprocess in the given project.
 * Captures stdout/stderr/exit code, enforces a hard timeout, and caps stream
 * sizes so a runaway command can't OOM the MCP server.
 *
 * Subprocess isolation is intentional — the MCP server is a long-lived stdio
 * process and running user commands in-process risks lifecycle leaks
 * (DB pools, observers, queue connections) and one-bug-crashes-everything.
 */
export async function runCommand(
  cwd:       string,
  name:      string,
  args:      string[],
  timeoutMs: number,
): Promise<CommandRunResult> {
  const pm = detectPackageManager(cwd)
  const { command, argv } = rudderArgv(pm, [name, ...args])

  const start = Date.now()
  return new Promise((resolve) => {
    const child = spawn(command, argv, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: { ...process.env, FORCE_COLOR: '0' },  // strip ANSI for agent-friendly output
    })

    let stdout = '', stderr = '', killed = false
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL') }, timeoutMs)

    child.stdout.on('data', (b: Buffer) => {
      if (stdout.length < STREAM_CAP_BYTES) stdout += b.toString('utf8')
    })
    child.stderr.on('data', (b: Buffer) => {
      if (stderr.length < STREAM_CAP_BYTES) stderr += b.toString('utf8')
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        stdout, stderr: stderr + String(err), exitCode: 1,
        durationMs: Date.now() - start, killed,
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (stdout.length >= STREAM_CAP_BYTES) stdout += `\n[truncated at ${STREAM_CAP_BYTES} bytes]`
      if (stderr.length >= STREAM_CAP_BYTES) stderr += `\n[truncated at ${STREAM_CAP_BYTES} bytes]`
      resolve({
        stdout, stderr, exitCode: killed ? 124 : (code ?? 0),
        durationMs: Date.now() - start, killed,
      })
    })
  })
}
