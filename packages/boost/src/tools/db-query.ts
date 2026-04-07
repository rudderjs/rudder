import { execSync } from 'node:child_process'

export async function executeDbQuery(cwd: string, query: string): Promise<string> {
  const trimmed = query.trim()
  const upper = trimmed.toUpperCase()

  if (!upper.startsWith('SELECT')) {
    return 'Error: Only SELECT queries are allowed. The query must start with SELECT.'
  }

  try {
    const result = execSync(
      `echo ${JSON.stringify(trimmed)} | npx prisma db execute --stdin`,
      { cwd, encoding: 'utf8', timeout: 15_000, stdio: ['pipe', 'pipe', 'pipe'] },
    )

    return result.trim() || 'Query executed successfully (no output).'
  } catch (err) {
    const message = err instanceof Error ? (err as Error & { stderr?: string }).stderr ?? err.message : String(err)
    return `Error executing query: ${message}`
  }
}
