// ─── Application ───────────────────────────────────────────

export {
  Application,
  RudderJS,
  AppBuilder,
  MiddlewareConfigurator,
  ExceptionConfigurator,
  appendToGroup,
  resetGroupMiddleware,
  app,
  resolve,
  defineConfig,
} from './application.js'
export type { BootConfig, ConfigureOptions, RoutingOptions, ErrorRenderer, ProviderClass } from './application.js'

// ─── DI ────────────────────────────────────────────────────

export { Container, ContextualBindingBuilder, container, Injectable, Inject, Tag, tagToken } from './di.js'

// ─── Service Provider ──────────────────────────────────────

export { ServiceProvider, getPublishGroups } from './service-provider.js'
export type { PublishGroup } from './service-provider.js'

// ─── Provider Auto-Discovery ───────────────────────────────

export { defaultProviders, getLastLoadedProviderEntries } from './default-providers.js'
export type { DefaultProvidersOptions } from './default-providers.js'
export { BUILTIN_REGISTRY } from './provider-registry.js'
export type { ProviderEntry, ProviderManifest, ProviderStage } from './provider-registry.js'
export { sortByStageAndDepends } from './provider-sort.js'
export { bootNotice, drainBootNotices } from './boot-notices.js'
export type { BootNotice } from './boot-notices.js'
export { bootLine } from './boot-line.js'

// ─── Events ────────────────────────────────────────────────

export { Listener, EventDispatcher, dispatcher, dispatch, eventsProvider } from './events.js'
export type { ListenMap } from './events.js'
export { EventFake } from './events-fake.js'
export type { DispatchedEvent } from './events-fake.js'

// ─── Validation ────────────────────────────────────────────

export { FormRequest, ValidationError, ValidationResponse, validate, validateWith, z } from './validation.js'
export type { AfterCallback, AfterContext, MessagesMap } from './validation.js'

// ─── Rudder ───────────────────────────────────────────────

export { rudder, Rudder, CommandRegistry, CommandBuilder, Command, CancelledError, parseSignature } from '@rudderjs/console'
export type { ConsoleHandler, CommandArgDef, CommandOptDef, ParsedSignature } from '@rudderjs/console'

// ─── Support ───────────────────────────────────────────────

export {
  Collection,
  Env,
  env,
  sleep,
  ucfirst,
  tap,
  pick,
  omit,
  defineEnv,
  ConfigRepository,
  setConfigRepository,
  getConfigRepository,
  resolveOptionalPeer,
  dump,
  dd,
} from '@rudderjs/support'

// ─── Exceptions ────────────────────────────────────────────

export {
  HttpException,
  abort,
  abort_if,
  abort_unless,
  report,
  report_if,
  setExceptionReporter,
} from './exceptions.js'

// ─── Typed config ──────────────────────────────────────────
// Overrides the untyped config() from @rudderjs/support with a version
// that infers return types from the augmented AppConfig interface.

export { config } from './config.js'
export type { AppConfig, ConfigKey, ConfigValue } from './config.js'

// ─── Maintenance mode ──────────────────────────────────────
// Node-only (static node:fs/node:path) — deliberately NOT re-exported from
// @rudderjs/core/client. app-builder reaches maintenanceMiddleware via a lazy
// import inside the server-only request-handler path.

export {
  isDownForMaintenance,
  maintenanceData,
  down,
  up,
  maintenanceMiddleware,
  MAINTENANCE_BYPASS_COOKIE,
} from './maintenance.js'
export type { MaintenanceData, MaintenanceMiddlewareOptions } from './maintenance.js'

// ─── Contracts ─────────────────────────────────────────────

export type {
  AppRequest,
  AppResponse,
  RouteHandler,
  MiddlewareHandler,
  HttpMethod,
  RouteDefinition,
  ServerAdapter,
  ServerAdapterFactory,
  FetchHandler,
  ServerAdapterProvider,
} from '@rudderjs/contracts'

// Runtime marker for request-scoped-context middleware — consumed by the
// WS-upgrade context runner registered below. Value export (not type-only).
export { REQUEST_CONTEXT } from '@rudderjs/contracts'

// ─── WebSocket-upgrade context runner ──────────────────────
// Server-only (uses a `node:http` type). Exposed so adapters/tests can build a
// runner directly; the framework registers it on its globalThis seam at boot.

export {
  createWsContextRunner,
  registerWsContextRunner,
  synthesizeRequest,
  makeThrowawayResponse,
} from './ws-context-runner.js'
export type { WsContextRunner } from './ws-context-runner.js'
