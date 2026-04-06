// ─── Application ───────────────────────────────────────────

export {
  Application,
  RudderJS,
  AppBuilder,
  MiddlewareConfigurator,
  ExceptionConfigurator,
  app,
  resolve,
  defineConfig,
} from './application.js'
export type { BootConfig, ConfigureOptions, RoutingOptions, ErrorRenderer, ProviderClass } from './application.js'

// ─── DI ────────────────────────────────────────────────────

export { Container, container, Injectable, Inject } from './di.js'

// ─── Service Provider ──────────────────────────────────────

export { ServiceProvider, getPublishGroups } from './service-provider.js'
export type { PublishGroup } from './service-provider.js'

// ─── Events ────────────────────────────────────────────────

export { Listener, EventDispatcher, dispatcher, dispatch, events } from './events.js'
export type { ListenMap } from './events.js'

// ─── Validation ────────────────────────────────────────────

export { FormRequest, ValidationError, validate, validateWith, z } from './validation.js'

// ─── Rudder ───────────────────────────────────────────────

export { rudder, Rudder, CommandRegistry, CommandBuilder, Command, CancelledError, parseSignature } from '@rudderjs/rudder'
export type { ConsoleHandler, CommandArgDef, CommandOptDef, ParsedSignature } from '@rudderjs/rudder'

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
export type { AppConfig } from './config.js'

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
