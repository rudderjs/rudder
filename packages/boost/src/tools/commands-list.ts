import { spawn } from 'node:child_process'
import { detectPackageManager, parseFirstJsonObject, rudderArgv } from './_pm.js'

export interface CommandEntry {
  name:        string
  description: string
  source:      'inline' | 'class' | 'builtin'
  args?:       Array<{ name: string; required: boolean; variadic: boolean; description?: string }>
  options?:    Array<{ flags: string; description: string }>
}

export interface CommandsListResult {
  commands:   CommandEntry[]
  bootError?: string
}

/**
 * Spawn `<pm> rudder command:list --all --json` in the given project and parse
 * the result. Returns built-in + package-contributed + user-registered commands.
 *
 * On boot failure (missing prisma client, broken provider, etc.) the cli
 * surfaces a `bootError` field and still returns built-in + package commands —
 * partial info beats an opaque crash for an agent mid-session.
 */
export async function listCommands(
  cwd: string,
  namespace?: string,
): Promise<CommandsListResult> {
  const pm = detectPackageManager(cwd)
  const { command, argv } = rudderArgv(pm, ['command:list', '--all', '--json'])

  const { stdout, stderr, code } = await spawnCapture(command, argv, cwd, 30_000)
  if (code !== 0 && !stdout.includes('{')) {
    throw new Error(`rudder command:list exited ${code}\nstderr:\n${stderr.slice(0, 1000)}`)
  }

  const parsed = parseFirstJsonObject<CommandsListResult>(stdout)
  if (!Array.isArray(parsed.commands)) {
    throw new Error(`Unexpected payload shape: ${JSON.stringify(parsed).slice(0, 200)}`)
  }

  if (namespace) {
    parsed.commands = parsed.commands.filter(c => {
      if (!c.name.includes(':')) return c.name === namespace
      return c.name.split(':')[0] === namespace
    })
  }

  return parsed
}

interface SpawnResult { stdout: string; stderr: string; code: number; killed: boolean }

function spawnCapture(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
    let stdout = '', stderr = '', killed = false
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL') }, timeoutMs)

    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8') })
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8') })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ stdout, stderr: stderr + String(err), code: 1, killed })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code: code ?? 0, killed })
    })
  })
}
