// `@rudderjs/mcp` is the Rudder binding over the framework-agnostic
// `@gemstack/mcp` server core. The full authoring surface (McpServer, McpTool,
// McpResource, McpPrompt, McpResponse, Mcp, the decorators, OAuth helpers,
// the test client, resolver seam, etc.) is re-exported from the core so
// existing `from '@rudderjs/mcp'` imports keep working unchanged.
export * from '@gemstack/mcp'

// Rudder-specific surface: the service provider that auto-discovers registered
// MCP servers, wires the Rudder container as the DI resolver, mounts web
// transports on the Rudder router, and registers the CLI commands + doctor.
export { McpProvider } from './provider.js'
