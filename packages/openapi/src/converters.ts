/**
 * The schema → JSON Schema converter registry moved to the shared
 * `@rudderjs/json-schema` package (neutral home so `@rudderjs/ai`/`mcp` reuse
 * it too — see that package's CLAUDE.md). Re-exported here so existing
 * `./converters.js` imports + this package's public surface keep working.
 */
export {
  convertSchema,
  registerSchemaConverter,
  getSchemaConverter,
  schemaVendor,
  type SchemaConverter,
  type SchemaIo,
  type JsonSchema,
} from '@rudderjs/json-schema'
