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
export type { AppConfig, ConfigureOptions, RoutingOptions } from './application.js'

// ─── DI ────────────────────────────────────────────────────

export { Container, container, Injectable, Inject } from './di.js'

// ─── Service Provider ──────────────────────────────────────

export { ServiceProvider } from './service-provider.js'

// ─── Events ────────────────────────────────────────────────

export { Listener, EventDispatcher, dispatcher, dispatch, events } from './events.js'
export type { ListenMap } from './events.js'

// ─── ORM ───────────────────────────────────────────────────

export { Model, ModelRegistry } from './orm.js'
export type {
  OrmAdapter,
  OrmAdapterProvider,
  QueryBuilder,
  PaginatedResult,
  WhereOperator,
  WhereClause,
  OrderClause,
  QueryState,
} from '@boostkit/contracts'

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
  config,
  resolveOptionalPeer,
  dump,
  dd,
} from '@boostkit/support'

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
