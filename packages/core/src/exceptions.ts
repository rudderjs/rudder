import type { AppRequest } from '@rudderjs/contracts'

// ─── HTTP Status Text Map ──────────────────────────────────

const HTTP_STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'Length Required',
  412: 'Precondition Failed',
  413: 'Content Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Content',
  423: 'Locked',
  424: 'Failed Dependency',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  451: 'Unavailable For Legal Reasons',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

// ─── HttpException ─────────────────────────────────────────

export class HttpException extends Error {
  readonly statusCode: number
  readonly headers: Record<string, string>

  constructor(
    statusCode: number,
    message?: string,
    headers: Record<string, string> = {},
  ) {
    super(message ?? HTTP_STATUS_TEXT[statusCode] ?? 'Error')
    this.name = 'HttpException'
    this.statusCode = statusCode
    this.headers = headers
  }
}

// ─── abort() helpers ──────────────────────────────────────

export function abort(status: number, message?: string, headers?: Record<string, string>): never {
  throw new HttpException(status, message, headers)
}

export function abort_if(condition: boolean, status: number, message?: string, headers?: Record<string, string>): void {
  if (condition) abort(status, message, headers)
}

export function abort_unless(condition: boolean, status: number, message?: string, headers?: Record<string, string>): void {
  if (!condition) abort(status, message, headers)
}

// ─── Reporter ─────────────────────────────────────────────

type ReporterFn = (err: unknown) => void

let _reporter: ReporterFn = (err: unknown): void => {
  console.error('[RudderJS]', err)
}

/**
 * Override the global exception reporter.
 *
 * Called by `@rudderjs/log`'s service provider automatically when the log
 * package is installed, routing all unhandled exceptions through the log
 * channel. Can also be called in bootstrap/app.ts via `e.reportUsing(fn)`.
 */
export function setExceptionReporter(fn: ReporterFn): void {
  _reporter = fn
}

/** Report an exception to the configured reporter (default: console.error). */
export function report(err: unknown): void {
  _reporter(err)
}

/** Conditionally report an exception. */
export function report_if(condition: boolean, err: unknown): void {
  if (condition) report(err)
}

// ─── Internal rendering helpers ───────────────────────────

function wantsJson(req: AppRequest): boolean {
  const accept = req.headers['accept'] ?? ''
  // Treat as JSON unless Accept explicitly prefers HTML
  if (!accept) return true
  if (accept.includes('application/json')) return true
  if (accept.includes('text/html') && !accept.includes('application/json')) return false
  return true
}

function htmlPage(status: number, message: string, detail?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${status} ${message}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#f8f9fa;color:#1a1a1a;
         display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:56px 48px;
          text-align:center;max-width:520px;width:100%;box-shadow:0 1px 3px rgba(0,0,0,.06)}
    h1{font-size:4.5rem;font-weight:800;color:#e5e7eb;line-height:1;margin-bottom:12px}
    h2{font-size:1.25rem;font-weight:600;color:#374151;margin-bottom:8px}
    p{font-size:.9rem;color:#6b7280;line-height:1.6}
    pre{margin-top:24px;text-align:left;background:#f3f4f6;border-radius:6px;
        padding:16px;font-size:.8rem;color:#374151;overflow:auto;white-space:pre-wrap;word-break:break-word}
  </style>
</head>
<body>
  <div class="card">
    <h1>${status}</h1>
    <h2>${message}</h2>
    ${detail ? `<pre>${detail}</pre>` : ''}
  </div>
</body>
</html>`
}

/** @internal — render an HttpException as a Response. */
export function renderHttpException(err: HttpException, req: AppRequest): Response {
  const status  = err.statusCode
  const message = err.message
  const headers: Record<string, string> = { ...err.headers }

  if (wantsJson(req)) {
    headers['Content-Type'] = 'application/json'
    return new Response(JSON.stringify({ message, status }), { status, headers })
  }

  headers['Content-Type'] = 'text/html; charset=utf-8'
  return new Response(htmlPage(status, message), { status, headers })
}

/** @internal — render an unhandled error as a 500 Response. */
export function renderServerError(req: AppRequest, debug: boolean, err: unknown): Response {
  const status  = 500
  const message = 'Internal Server Error'
  const headers: Record<string, string> = {}

  if (wantsJson(req)) {
    headers['Content-Type'] = 'application/json'
    const body: Record<string, unknown> = { message, status }
    if (debug && err instanceof Error) {
      body['exception'] = err.message
      if (err.stack) body['trace'] = err.stack.split('\n').slice(1).map(l => l.trim())
    }
    return new Response(JSON.stringify(body), { status, headers })
  }

  headers['Content-Type'] = 'text/html; charset=utf-8'
  const detail = debug && err instanceof Error && err.stack ? err.stack : undefined
  return new Response(htmlPage(status, message, detail), { status, headers })
}
