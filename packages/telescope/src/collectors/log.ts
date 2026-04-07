import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'

/**
 * Records log entries by hooking into @rudderjs/log's listener API.
 */
export class LogCollector implements Collector {
  readonly name = 'Log Collector'
  readonly type = 'log' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { Log } = await import('@rudderjs/log') as {
        Log: { listen: (fn: (entry: LogEntry) => void) => void }
      }
      Log.listen((entry) => this.record(entry))
    } catch {
      // @rudderjs/log not installed — skip
    }
  }

  private record(entry: LogEntry): void {
    const tags: string[] = [`level:${entry.level}`]
    if (['error', 'critical', 'alert', 'emergency'].includes(entry.level)) {
      tags.push('error')
    }

    this.storage.store(createEntry('log', {
      level:     entry.level,
      message:   entry.message,
      context:   entry.context,
      channel:   entry.channel,
      timestamp: entry.timestamp.toISOString(),
    }, { tags }))
  }
}

interface LogEntry {
  level:     string
  message:   string
  context:   Record<string, unknown>
  timestamp: Date
  channel:   string
}
