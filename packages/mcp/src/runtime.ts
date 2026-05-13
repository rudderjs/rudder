// Barrel re-exporting the runtime's sibling modules. Each sibling owns one
// concern: SDK wiring, HTTP transport, DI helpers, tool-return consumption,
// observer-registry access. Touch the siblings — this file is intentionally
// thin so external consumers (provider, inspector, testing, telescope) keep
// their `from './runtime.js'` / `from '../runtime.js'` imports stable.

export { createSdkServer, startStdio } from './runtime/sdk-server.js'
export { mountHttpTransport, type HttpTransportOptions } from './runtime/http-transport.js'
export { consumeToolReturn } from './runtime/consume-tool-return.js'
export { resolveHandleDeps, isRegistered, filterRegistered } from './runtime/handle-deps.js'
