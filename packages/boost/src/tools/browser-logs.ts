import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function readBrowserLogs(cwd: string, count = 50): Promise<string> {
  const logPaths = [
    join(cwd, 'storage', 'logs', 'browser.log'),
    join(cwd, '.rudder', 'browser.log'),
  ]

  for (const logPath of logPaths) {
    if (!existsSync(logPath)) continue

    const content = readFileSync(logPath, 'utf8')
    const lines = content.split('\n').filter(l => l.trim())
    const result = lines.slice(-count)

    if (result.length === 0) {
      return Promise.resolve('Browser log file is empty.')
    }

    return Promise.resolve(result.join('\n'))
  }

  return Promise.resolve(
    'No browser log file found. Browser logging is not configured.\n' +
    'Expected location: storage/logs/browser.log or .rudder/browser.log',
  )
}
