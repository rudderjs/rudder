import 'reflect-metadata'
import type {
  ServerAdapter,
  RouteDefinition,
  RouteHandler,
  MiddlewareHandler,
  HttpMethod,
} from '@rudderjs/contracts'

// ─── Metadata Keys ─────────────────────────────────────────

const CONTROLLER_PREFIX     = 'rudderjs:controller:prefix'
const CONTROLLER_MIDDLEWARE = 'rudderjs:controller:middleware'
const ROUTE_DEFINITIONS     = 'rudderjs:route:definitions'
const ROUTE_MIDDLEWARE      = 'rudderjs:route:middleware'

// ─── Route Meta (stored per method) ───────────────────────

interface RouteMeta {
  method:     HttpMethod
  path:       string
  handlerKey: string | symbol
  middleware: MiddlewareHandler[]
}

// ─── Decorators ────────────────────────────────────────────

/** Mark a class as a controller with an optional route prefix */
export function Controller(prefix = ''): ClassDecorator {
  return target => {
    Reflect.defineMetadata(CONTROLLER_PREFIX, prefix, target)
  }
}

/** Attach middleware to a controller class or route method */
export function Middleware(middleware: MiddlewareHandler[]): ClassDecorator & MethodDecorator {
  return (target: object, key?: string | symbol) => {
    if (key) {
      // Method-level middleware (supports both decorator orders)
      const perHandler: Record<string, MiddlewareHandler[]> =
        Reflect.getMetadata(ROUTE_MIDDLEWARE, target) ?? {}
      const handlerKey = String(key)
      perHandler[handlerKey] = [...(perHandler[handlerKey] ?? []), ...middleware]
      Reflect.defineMetadata(ROUTE_MIDDLEWARE, perHandler, target)

      // If route metadata already exists, merge immediately too.
      const routes: RouteMeta[] = Reflect.getMetadata(ROUTE_DEFINITIONS, target) ?? []
      const route = routes.find(r => r.handlerKey === key)
      if (route) route.middleware = [...middleware, ...route.middleware]
    } else {
      // Class-level middleware
      Reflect.defineMetadata(CONTROLLER_MIDDLEWARE, middleware, target)
    }
  }
}

/** Create an HTTP method decorator */
function createMethodDecorator(method: HttpMethod) {
  return (path = '/'): MethodDecorator =>
    (target, key) => {
      const perHandler: Record<string, MiddlewareHandler[]> =
        Reflect.getMetadata(ROUTE_MIDDLEWARE, target) ?? {}
      const handlerMiddleware = perHandler[String(key)] ?? []

      const routes: RouteMeta[] =
        Reflect.getMetadata(ROUTE_DEFINITIONS, target) ?? []
      routes.push({ method, path, handlerKey: key, middleware: [...handlerMiddleware] })
      Reflect.defineMetadata(ROUTE_DEFINITIONS, routes, target)
    }
}

export const Get     = createMethodDecorator('GET')
export const Post    = createMethodDecorator('POST')
export const Put     = createMethodDecorator('PUT')
export const Patch   = createMethodDecorator('PATCH')
export const Delete  = createMethodDecorator('DELETE')
export const Options = createMethodDecorator('OPTIONS')

// ─── Router ────────────────────────────────────────────────

export class Router {
  private routes: RouteDefinition[] = []
  private globalMiddleware: MiddlewareHandler[] = []

  /** Clear registered routes and global middleware */
  reset(): this {
    this.routes = []
    this.globalMiddleware = []
    return this
  }

  /** Register a global middleware (runs on every route) */
  use(middleware: MiddlewareHandler): this {
    this.globalMiddleware.push(middleware)
    return this
  }

  /** Manually register a route */
  add(
    method: HttpMethod,
    path: string,
    handler: RouteHandler,
    middleware: MiddlewareHandler[] = []
  ): this {
    this.routes.push({ method, path, handler, middleware })
    return this
  }

  // Shorthand methods
  get   (path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]) { return this.add('GET',    path, handler, middleware) }
  post  (path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]) { return this.add('POST',   path, handler, middleware) }
  put   (path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]) { return this.add('PUT',    path, handler, middleware) }
  patch (path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]) { return this.add('PATCH',  path, handler, middleware) }
  delete(path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]) { return this.add('DELETE', path, handler, middleware) }
  all   (path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]) { return this.add('ALL',    path, handler, middleware) }

  /** Register all routes from a decorator-based controller class */
  registerController(ControllerClass: new () => object): this {
    const instance   = new ControllerClass() as Record<string, unknown>
    const prefix     = Reflect.getMetadata(CONTROLLER_PREFIX, ControllerClass) ?? ''
    const ctrlMw: MiddlewareHandler[] =
      Reflect.getMetadata(CONTROLLER_MIDDLEWARE, ControllerClass) ?? []
    const routes: RouteMeta[] =
      Reflect.getMetadata(ROUTE_DEFINITIONS, ControllerClass.prototype) ?? []

    for (const route of routes) {
      const fullPath = `${prefix}${route.path}`.replace(/\/+/g, '/')
      const handler  = (instance[route.handlerKey as string] as RouteHandler)
        .bind(instance)

      this.routes.push({
        method:     route.method,
        path:       fullPath,
        handler,
        middleware: [...ctrlMw, ...route.middleware],
      })
    }

    return this
  }

  /** Mount all routes onto a server adapter */
  mount(server: ServerAdapter): void {
    // Apply global middleware first
    for (const mw of this.globalMiddleware) {
      server.applyMiddleware(mw)
    }

    // Register all routes
    for (const route of this.routes) {
      server.registerRoute(route)
    }
  }

  /** Get all registered routes (useful for rudderjs routes:list) */
  list(): RouteDefinition[] {
    return [...this.routes]
  }
}

// ─── Global router instance ────────────────────────────────

export const router = new Router()

/** Alias for router — Laravel-style capitalised name */
export const Route = router