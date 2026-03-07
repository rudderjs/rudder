// ─── Application ───────────────────────────────────────────

export {
  Application,
  BoostKit,
  AppBuilder,
  MiddlewareConfigurator,
  ExceptionConfigurator,
  app,
  resolve,
  defineConfig,
} from './application.js'
export type { BootConfig, ConfigureOptions, RoutingOptions, ErrorRenderer } from './application.js'

// ─── DI ────────────────────────────────────────────────────

export { Container, container, Injectable, Inject } from './di.js'

// ─── Service Provider ──────────────────────────────────────

export { ServiceProvider } from './service-provider.js'

// ─── Events ────────────────────────────────────────────────

export { Listener, EventDispatcher, dispatcher, dispatch, events } from './events.js'
export type { ListenMap } from './events.js'

// ─── Validation ────────────────────────────────────────────

export { FormRequest, ValidationError, validate, validateWith, z } from './validation.js'

// ─── Artisan ───────────────────────────────────────────────

export { artisan, Artisan, ArtisanRegistry, CommandBuilder, Command, CancelledError, parseSignature } from '@boostkit/artisan'
export type { ConsoleHandler, CommandArgDef, CommandOptDef, ParsedSignature } from '@boostkit/artisan'

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
} from '@boostkit/support'

// ─── Typed config ──────────────────────────────────────────
// Overrides the untyped config() from @boostkit/support with a version
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
} from '@boostkit/contracts'
