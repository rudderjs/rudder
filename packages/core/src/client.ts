// Client-safe subset of @rudderjs/core.
//
// The main `@rudderjs/core` entry re-exports `@rudderjs/console` — a CLI library
// whose `@clack/*` dependency *statically* imports `node:process` / `node:fs` at
// module top level — and a few server/CLI/test-only modules (`default-providers`
// reads the manifest via `node:fs`, `events-fake` uses `node:assert`). That makes
// the main entry crash when bundled into the browser (`process is not defined`).
//
// Code reachable from BOTH server and client — shared service classes, form
// requests, config/env access, DI — should import from `@rudderjs/core/client`.
// This entry omits the console re-export and every Node-only module, so it
// evaluates in the browser. It is enforced by the client-bundle smoke gate
// (`scripts/client-bundle-smoke.mjs`).
//
// Anything dropped here vs. the main entry is server/CLI-only by design:
// `defaultProviders` / provider-registry (manifest fs read), `EventFake`
// (node:assert), `resolveOptionalPeer` / `dump` / `dd` (node:module/url/fs).

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

// ─── Events ────────────────────────────────────────────────

export { Listener, EventDispatcher, dispatcher, dispatch, eventsProvider } from './events.js'
export type { ListenMap } from './events.js'

// ─── Validation ────────────────────────────────────────────

export { FormRequest, ValidationError, ValidationResponse, validate, validateWith, z } from './validation.js'
export type { AfterCallback, AfterContext, MessagesMap } from './validation.js'

// ─── Support (client-safe symbols only) ────────────────────

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

export { config } from './config.js'
export type { AppConfig, ConfigKey, ConfigValue } from './config.js'

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

export { REQUEST_CONTEXT } from '@rudderjs/contracts'
