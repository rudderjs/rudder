import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runCommand } from './command-run.js'
import { parseFirstJsonObject } from './_pm.js'

/**
 * Run a read-only SELECT against the application database.
 *
 * Primary path: spawn `rudder db:query`, which rides the DB facade
 * (`DB.select`) on whatever adapter the app runs — native (the create-rudder
 * default), drizzle, AND prisma — and prints the actual rows as JSON.
 *
 * Fallback (prisma apps only, when the app can't boot): shell
 * `prisma db execute --stdin`. Note its limitation — prisma db execute is a
 * no-output command, so a SELECT "succeeds" without returning rows; it's
 * strictly a last resort, which is why it is no longer the primary path.
 *
 * The query travels as a single argv element with `shell: false` (rudder) or
 * via stdin (prisma) — never interpolated into a shell string.
 */
export async function executeDbQuery(cwd: string, query: string): Promise<string> {
  const trimmed = query.trim()
  const upper = trimmed.toUpperCase()

  if (!upper.startsWith('SELECT')) {
    return 'Error: Only SELECT queries are allowed. The query must start with SELECT.'
  }

  // `rudder db:query` prints `{ "rows": [...] }` on stdout (after any
  // dev-mode boot-log lines — hence the tolerant first-{...} scan).
  const result = await runCommand(cwd, 'db:query', [trimmed], 30_000)
  if (result.exitCode === 0) {
    try {
      const { rows } = parseFirstJsonObject<{ rows: unknown[] }>(result.stdout)
      return JSON.stringify(rows, null, 2)
    } catch {
      return result.stdout.trim() || 'Query executed successfully (no output).'
    }
  }

  if (hasPrismaSchema(cwd)) {
    try {
      // Constant command string; the query is passed via stdin, not the shell.
      const prismaResult = execSync('npx prisma db execute --stdin', {
        cwd, encoding: 'utf8', timeout: 15_000, input: trimmed, stdio: ['pipe', 'pipe', 'pipe'],
      })
      return prismaResult.trim() || 'Query executed successfully (no output).'
    } catch (err) {
      const message = err instanceof Error ? (err as Error & { stderr?: string }).stderr ?? err.message : String(err)
      return `Error executing query: ${message}`
    }
  }

  const detail = (result.stderr || result.stdout).trim()
  return `Error executing query: ${detail || `rudder db:query exited with code ${result.exitCode}`}`
}

function hasPrismaSchema(cwd: string): boolean {
  return existsSync(join(cwd, 'prisma', 'schema')) || existsSync(join(cwd, 'prisma', 'schema.prisma'))
}
