// Re-export the core runtime primitives (createSdkServer, startStdio,
// createWebRequestHandler, createMcpHttpHandler, consumeToolReturn, the DI
// helpers) so the `@rudderjs/mcp/runtime` subpath keeps working unchanged...
export * from '@gemstack/mcp/runtime'

// ...plus the Rudder-specific Hono mount, which wraps the core's neutral
// Web-request handler onto the Rudder router.
export { mountHttpTransport, type HttpTransportOptions } from './runtime/http-transport.js'
