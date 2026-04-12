import type { Collector, TelescopeStorage } from '../types.js'
import { createEntry } from '../storage.js'
import { redactHeaders } from '../redact.js'
import { batchOpts } from '../batch-context.js'

interface HttpEvent {
  kind: string
  method: string
  url: string
  duration: number
  reqHeaders: Record<string, string>
  reqBody: unknown
  status?: number
  resHeaders?: Record<string, string>
  resBody?: string
  resSize?: number
  error?: string
}

/**
 * Records outgoing HTTP requests made through `@rudderjs/http` by
 * subscribing to the `httpObservers` registry. Each completed or
 * failed request becomes an `http` entry in telescope.
 *
 * Only captures traffic routed through the framework's HTTP client
 * (`Http.get()`, `Http.post()`, etc.) — raw `fetch()` calls from
 * third-party libraries are not intercepted. A global fetch wrapper
 * is a separate future effort.
 */
export class HttpCollector implements Collector {
  readonly name = 'HTTP Client Collector'
  readonly type = 'http' as const

  constructor(
    private readonly storage: TelescopeStorage,
    private readonly hideHeaders: string[] = ['authorization', 'cookie', 'set-cookie', 'x-csrf-token', 'x-api-key'],
  ) {}

  async register(): Promise<void> {
    try {
      const { httpObservers } = await import('@rudderjs/http/observers') as {
        httpObservers: { subscribe: (fn: (e: HttpEvent) => void) => void }
      }
      httpObservers.subscribe((event) => this.record(event))
    } catch {
      // @rudderjs/http not installed — skip
    }
  }

  private record(event: HttpEvent): void {
    const tags: string[] = [`kind:${event.kind}`]

    if (event.kind === 'request.completed' && event.status != null) {
      tags.push(`status:${event.status}`)
      if (event.status >= 400) tags.push('error')
    }
    if (event.kind === 'request.failed') tags.push('error')
    if (event.duration > 1000) tags.push('slow')

    // Redact sensitive headers before storing
    const content: Record<string, unknown> = {
      kind:       event.kind,
      method:     event.method,
      url:        event.url,
      duration:   event.duration,
      reqHeaders: redactHeaders(event.reqHeaders, this.hideHeaders),
      reqBody:    event.reqBody,
    }

    if (event.kind === 'request.completed') {
      content['status']     = event.status
      content['resHeaders'] = redactHeaders(event.resHeaders, this.hideHeaders)
      content['resBody']    = event.resBody
      content['resSize']    = event.resSize
    }
    if (event.kind === 'request.failed') {
      content['error'] = event.error
    }

    this.storage.store(createEntry('http', content, { tags, ...batchOpts() }))
  }
}
