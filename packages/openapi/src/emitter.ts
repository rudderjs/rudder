import type { RouteDefinition } from '@rudderjs/contracts'
import { convertSchema, schemaVendor } from './converters.js'
import { parsePath } from './path-template.js'
import type {
  JsonSchema,
  OpenApiDocument,
  OpenApiInfo,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiResponse,
  OpenApiServer,
  RouterLike,
} from './types.js'

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head'] as const
type HttpMethodKey = (typeof HTTP_METHODS)[number]

/** A route registered with `router.all(...)` answers any method. */
const ALL_METHODS: HttpMethodKey[] = ['get', 'post', 'put', 'patch', 'delete']

export interface GenerateOptions extends OpenApiInfo {
  servers?: OpenApiServer[]
  /**
   * Sink for "no converter / unrepresentable schema" warnings. Defaults to
   * `console.warn`. The emitter never throws on a bad schema — it warns and
   * omits that one schema so the rest of the document stays valid.
   */
  onWarn?: (message: string) => void
}

/**
 * Walk a router's route table and emit an OpenAPI 3.1 document from the
 * introspectable schemas Phase 1 retained on each `RouteDefinition`
 * (`name` / `bodySchema` / `querySchema` / `responses`).
 *
 * Schemas are converted to JSON Schema through the pluggable converter registry
 * (zod by default). A route whose validator has no registered converter is
 * warned about and its schema omitted — never a broken spec.
 */
export function generateOpenApiDocument(router: RouterLike, info: GenerateOptions): OpenApiDocument {
  const warn = info.onWarn ?? ((m: string) => console.warn(m))
  const paths: Record<string, OpenApiPathItem> = {}
  // operationIds MUST be unique across the document (OpenAPI 3.1). An `all()`
  // route expands to several methods and named/synthesized ids can collide, so
  // we track issued ids and disambiguate.
  const usedIds = new Set<string>()

  for (const def of router.list()) {
    const { template, params } = parsePath(def.path)
    const methods = methodKeysFor(def.method)
    if (methods.length === 0) continue

    const multi = methods.length > 1
    const item = (paths[template] ??= {})
    for (const method of methods) {
      // Explicit single-method routes win over an `all()` catch-all on the
      // same path+method — don't clobber a declared operation.
      if (item[method] !== undefined) continue
      const operation = buildOperation(def, params, warn)
      operation.operationId = uniqueId(operationIdFor(def, method, multi), usedIds)
      item[method] = operation
    }
  }

  const doc: OpenApiDocument = {
    openapi: '3.1.0',
    info: {
      title:   info.title,
      version: info.version,
      ...(info.description !== undefined ? { description: info.description } : {}),
    },
    paths,
  }
  if (info.servers && info.servers.length > 0) doc.servers = info.servers
  return doc
}

function methodKeysFor(method: string): HttpMethodKey[] {
  const lower = method.toLowerCase()
  if (lower === 'all') return [...ALL_METHODS]
  return (HTTP_METHODS as readonly string[]).includes(lower) ? [lower as HttpMethodKey] : []
}

function buildOperation(
  def: RouteDefinition,
  pathParams: ReturnType<typeof parsePath>['params'],
  warn: (m: string) => void,
): OpenApiOperation {
  const operation: OpenApiOperation = {
    responses: buildResponses(def, warn),
  }

  const parameters: OpenApiParameter[] = [
    ...pathParams.map((p): OpenApiParameter => ({
      name:     p.name,
      in:       'path',
      required: true,
      schema:   { type: p.integer ? 'integer' : 'string' },
    })),
    ...buildQueryParameters(def, warn),
  ]
  if (parameters.length > 0) operation.parameters = parameters

  const body = buildRequestBody(def, warn)
  if (body !== undefined) operation.requestBody = body

  return operation
}

/**
 * `operationId` ← `def.name` when the route is named (the natural, stable id);
 * an `all()` route answering multiple methods appends the method so its expanded
 * operations don't collide. Unnamed routes get a synthesized `method_slug` id so
 * the document stays valid without forcing every route to be named.
 */
function operationIdFor(def: RouteDefinition, method: string, multi: boolean): string {
  if (def.name) return multi ? `${def.name}_${method}` : def.name
  // Split on runs of non-alphanumerics and rejoin with `_`. Using split+filter
  // (linear) instead of an anchored `^_+|_+$` trim avoids a polynomial-regex
  // ReDoS on adversarial paths. Wildcard `*` → `all` so `/x/*` ≠ `/x`.
  const slug = def.path
    .replace(/\*/g, 'all')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .join('_')
  return `${method}_${slug || 'root'}`
}

/** Ensure an operationId is unique, appending `_2`, `_3`, … on collision. */
function uniqueId(base: string, used: Set<string>): string {
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}_${n++}`
  used.add(id)
  return id
}

function buildQueryParameters(def: RouteDefinition, warn: (m: string) => void): OpenApiParameter[] {
  if (def.querySchema === undefined) return []
  const json = convert(def.querySchema, 'input', def, 'query', warn)
  if (json === null) return []
  if (json.type !== 'object' || typeof json.properties !== 'object' || json.properties === null) {
    warn(`[openapi] query schema for ${def.method} ${def.path} is not an object — skipped.`)
    return []
  }

  const properties = json.properties as Record<string, JsonSchema>
  const required = new Set(Array.isArray(json.required) ? (json.required as string[]) : [])
  return Object.entries(properties).map(([name, schema]): OpenApiParameter => {
    const { description, ...rest } = schema
    const param: OpenApiParameter = { name, in: 'query', schema: rest }
    if (required.has(name)) param.required = true
    if (typeof description === 'string') param.description = description
    return param
  })
}

function buildRequestBody(def: RouteDefinition, warn: (m: string) => void) {
  if (def.bodySchema === undefined) return undefined
  const json = convert(def.bodySchema, 'input', def, 'body', warn)
  if (json === null) return undefined
  return {
    required: true,
    content: { 'application/json': { schema: json } },
  }
}

function buildResponses(def: RouteDefinition, warn: (m: string) => void): Record<string, OpenApiResponse> {
  const responses: Record<string, OpenApiResponse> = {}

  if (def.responses) {
    for (const [status, decl] of Object.entries(def.responses)) {
      const description = decl.description ?? defaultStatusText(Number(status))
      const json = convert(decl.schema, 'output', def, `response ${status}`, warn)
      responses[status] = json === null
        ? { description }
        : { description, content: { 'application/json': { schema: json } } }
    }
  }

  // No declared responses → a generic 200 so the operation is spec-valid.
  if (Object.keys(responses).length === 0) {
    responses['200'] = { description: 'OK' }
  }
  return responses
}

function convert(
  schema: unknown,
  io: 'input' | 'output',
  def: RouteDefinition,
  where: string,
  warn: (m: string) => void,
): JsonSchema | null {
  const json = convertSchema(schema, io)
  if (json === null) {
    const vendor = schemaVendor(schema)
    const reason = vendor === undefined
      ? 'schema has no Standard Schema `~standard` tag'
      : `no JSON-Schema converter registered for vendor "${vendor}" (registerSchemaConverter)`
    warn(`[openapi] ${def.method} ${def.path} ${where}: ${reason} — skipped.`)
  }
  return json
}

function defaultStatusText(status: number): string {
  const text: Record<number, string> = {
    200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
    409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
    500: 'Internal Server Error', 503: 'Service Unavailable',
  }
  return text[status] ?? 'Response'
}
