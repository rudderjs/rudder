// @rudderjs/openapi — auto-generate an OpenAPI 3.1 spec from RudderJS typed
// routes. Opt-in (Lighthouse model): never pulled into the kernel, auto-discovery
// off by default. See CLAUDE.md.

export { generateOpenApiDocument, type GenerateOptions } from './emitter.js'
export {
  registerSchemaConverter,
  getSchemaConverter,
  schemaVendor,
  convertSchema,
  type SchemaConverter,
  type SchemaIo,
} from './converters.js'
export { registerOpenApiRoutes, type OpenApiRouter, type OpenApiRouteOptions } from './routes.js'
export { OpenApiProvider } from './provider.js'
export { swaggerUiHtml } from './swagger-ui.js'
export { resolveDocInfo } from './doc-info.js'
export { toYaml } from './yaml.js'
export type {
  JsonSchema,
  OpenApiConfig,
  OpenApiDocument,
  OpenApiInfo,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiPathItem,
  OpenApiRequestBody,
  OpenApiResponse,
  OpenApiServer,
  RouterLike,
} from './types.js'
