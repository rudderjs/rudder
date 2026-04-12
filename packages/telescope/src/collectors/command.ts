import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'

/** Mirrors `@rudderjs/rudder`'s CommandObservation type — duplicated locally so the collector compiles even when the optional peer is absent. */
interface CommandObservation {
  name:     string
  args:     Record<string, unknown>
  opts:     Record<string, unknown>
  duration: number
  exitCode: number
  source:   'class' | 'inline'
  error?:   Error
}

/**
 * Records every `rudder` CLI invocation by subscribing to the
 * `commandObservers` registry exported from `@rudderjs/rudder`. The CLI
 * runner emits one observation per command (success or failure) including
 * name, parsed args/opts, duration, exit code, and any thrown error.
 *
 * Self-contained: no app middleware, no router involvement. The collector
 * just subscribes once at boot. If `@rudderjs/rudder` is not installed
 * (impossible in practice since telescope depends on it transitively),
 * the import quietly fails and no commands are recorded.
 */
export class CommandCollector implements Collector {
  readonly name = 'Command Collector'
  readonly type = 'command' as const

  constructor(private readonly storage: TelescopeStorage) {}

  async register(): Promise<void> {
    try {
      const { commandObservers } = await import('@rudderjs/rudder') as {
        commandObservers: { subscribe: (fn: (obs: CommandObservation) => void) => void }
      }
      commandObservers.subscribe((obs) => this.record(obs))
    } catch {
      // @rudderjs/rudder not available — skip
    }
  }

  private record(obs: CommandObservation): void {
    const tags: string[] = [
      `source:${obs.source}`,
      `status:${obs.exitCode === 0 ? 'success' : 'failed'}`,
    ]
    if (obs.error)        tags.push('error')
    if (obs.exitCode === 130) tags.push('cancelled')

    const content: Record<string, unknown> = {
      name:     obs.name,
      args:     obs.args,
      opts:     obs.opts,
      duration: obs.duration,
      exitCode: obs.exitCode,
      source:   obs.source,
    }
    if (obs.error) {
      content['error'] = {
        message: obs.error.message,
        stack:   obs.error.stack,
      }
    }

    this.storage.store(createEntry('command', content, { tags }))
  }
}
