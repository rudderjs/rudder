import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface ReadLogsOptions {
  count?: number | undefined
  level?: string | undefined
  search?: string | undefined
}

export function readLogs(cwd: string, options: ReadLogsOptions = {}): Promise<string> {
  const { count = 20, level = 'all', search } = options

  const logPaths = [
    join(cwd, 'storage', 'logs'),
    join(cwd, 'logs'),
  ]

  for (const logDir of logPaths) {
    if (!existsSync(logDir)) continue

    const files = readdirSync(logDir)
      .filter(f => f.endsWith('.log'))
      .map(f => ({ name: f, mtime: statSync(join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length === 0) continue

    const latest = readFileSync(join(logDir, files[0]!.name), 'utf8')
    let lines = latest.split('\n').filter(l => l.trim())

    if (level !== 'all') {
      const upperLevel = level.toUpperCase()
      lines = lines.filter(l => l.toUpperCase().includes(upperLevel))
    }

    if (search) {
      const lower = search.toLowerCase()
      lines = lines.filter(l => l.toLowerCase().includes(lower))
    }

    const result = lines.slice(-count)

    if (result.length === 0) {
      return Promise.resolve('No matching log entries found.')
    }

    return Promise.resolve(result.join('\n'))
  }

  return Promise.resolve('No log files found in storage/logs/ or logs/')
}
