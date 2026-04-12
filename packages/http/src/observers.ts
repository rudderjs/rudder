/**
 * HTTP client event observers — process-wide pub/sub for outgoing HTTP
 * requests made through `@rudderjs/http`. Any package can subscribe to
 * be notified about completed or failed requests.
 *
 * Used today by `@rudderjs/telescope`'s HttpCollector to record
 * outgoing HTTP traffic into the dashboard. The registry is defined
 * here (inside `@rudderjs/http`) so the observer contract lives with
 * the package that owns the HTTP abstraction.
 */

/** Discriminated union of every event the HTTP client can emit. */
export type HttpEvent =
  | {
      kind:       'request.completed'
      method:     string
      url:        string
      status:     number
      duration:   number
      reqHeaders: Record<string, string>
      reqBody:    unknown
      resHeaders: Record<string, string>
      resBody:    string
      resSize:    number
    }
  | {
      kind:       'request.failed'
      method:     string
      url:        string
      duration:   number
      reqHeaders: Record<string, string>
      reqBody:    unknown
      error:      string
    }

export type HttpObserver = (event: HttpEvent) => void

export class HttpObserverRegistry {
  private observers: HttpObserver[] = []

  /** Subscribe; returns an unsubscribe function. */
  subscribe(fn: HttpObserver): () => void {
    this.observers.push(fn)
    return () => { this.observers = this.observers.filter(o => o !== fn) }
  }

  /**
   * Called by `PendingRequest._send()` after each outgoing request.
   * Errors thrown by observers are swallowed — observability must never
   * break HTTP requests.
   */
  emit(event: HttpEvent): void {
    for (const o of this.observers) {
      try { o(event) } catch { /* observer errors must not break http */ }
    }
  }

  /** @internal — used in tests */
  reset(): void { this.observers = [] }
}

// Process-wide singleton, like `broadcastObservers` in `@rudderjs/broadcast`.
const _g = globalThis as Record<string, unknown>
if (!_g['__rudderjs_http_observers__']) {
  _g['__rudderjs_http_observers__'] = new HttpObserverRegistry()
}

export const httpObservers = _g['__rudderjs_http_observers__'] as HttpObserverRegistry
