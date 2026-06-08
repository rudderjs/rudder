// Minimal OpenAPI 3.1 document types. Not exhaustive — just the surface the
// emitter produces. `JsonSchema`/operation objects stay loose (`Record`) so we
// don't reimplement the full spec; consumers get a structurally-valid document.

/** A JSON Schema object (OpenAPI 3.1 uses the 2020-12 dialect). */
export type JsonSchema = Record<string, unknown>

export interface OpenApiInfo {
  title:        string
  version:      string
  description?: string
}

export interface OpenApiServer {
  url:          string
  description?: string
}

export interface OpenApiParameter {
  name:         string
  in:           'path' | 'query' | 'header' | 'cookie'
  required?:    boolean
  description?: string
  schema:       JsonSchema
}

export interface OpenApiMediaType {
  schema: JsonSchema
}

export interface OpenApiRequestBody {
  required?: boolean
  content:   Record<string, OpenApiMediaType>
}

export interface OpenApiResponse {
  description: string
  content?:    Record<string, OpenApiMediaType>
}

export interface OpenApiOperation {
  operationId?: string
  parameters?:  OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses:    Record<string, OpenApiResponse>
}

export type OpenApiPathItem = Partial<Record<
  'get' | 'put' | 'post' | 'delete' | 'patch' | 'options' | 'head' | 'trace',
  OpenApiOperation
>>

export interface OpenApiDocument {
  openapi:  '3.1.0'
  info:     OpenApiInfo
  servers?: OpenApiServer[]
  paths:    Record<string, OpenApiPathItem>
}

/**
 * Config read from `config('openapi')` (all optional — the emitter `info` arg
 * and sensible defaults fill any gaps).
 */
export interface OpenApiConfig {
  title?:       string
  version?:     string
  description?: string
  servers?:     OpenApiServer[]
  /** Route-mount defaults consumed by `registerOpenApiRoutes`. */
  docsPath?:    string
  specPath?:    string
}

/** The structural slice of a router the emitter needs — just `list()`. */
export interface RouterLike {
  list(): import('@rudderjs/contracts').RouteDefinition[]
}
