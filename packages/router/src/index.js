import 'reflect-metadata';
// ─── Metadata Keys ─────────────────────────────────────────
const CONTROLLER_PREFIX = 'forge:controller:prefix';
const CONTROLLER_MIDDLEWARE = 'forge:controller:middleware';
const ROUTE_DEFINITIONS = 'forge:route:definitions';
const ROUTE_MIDDLEWARE = 'forge:route:middleware';
// ─── Decorators ────────────────────────────────────────────
/** Mark a class as a controller with an optional route prefix */
export function Controller(prefix = '') {
    return target => {
        Reflect.defineMetadata(CONTROLLER_PREFIX, prefix, target);
    };
}
/** Attach middleware to a controller class or route method */
export function Middleware(middleware) {
    return (target, key) => {
        if (key) {
            // Method-level middleware (supports both decorator orders)
            const perHandler = Reflect.getMetadata(ROUTE_MIDDLEWARE, target) ?? {};
            const handlerKey = String(key);
            perHandler[handlerKey] = [...(perHandler[handlerKey] ?? []), ...middleware];
            Reflect.defineMetadata(ROUTE_MIDDLEWARE, perHandler, target);
            // If route metadata already exists, merge immediately too.
            const routes = Reflect.getMetadata(ROUTE_DEFINITIONS, target) ?? [];
            const route = routes.find(r => r.handlerKey === key);
            if (route)
                route.middleware = [...middleware, ...route.middleware];
        }
        else {
            // Class-level middleware
            Reflect.defineMetadata(CONTROLLER_MIDDLEWARE, middleware, target);
        }
    };
}
/** Create an HTTP method decorator */
function createMethodDecorator(method) {
    return (path = '/') => (target, key) => {
        const perHandler = Reflect.getMetadata(ROUTE_MIDDLEWARE, target) ?? {};
        const handlerMiddleware = perHandler[String(key)] ?? [];
        const routes = Reflect.getMetadata(ROUTE_DEFINITIONS, target) ?? [];
        routes.push({ method, path, handlerKey: key, middleware: [...handlerMiddleware] });
        Reflect.defineMetadata(ROUTE_DEFINITIONS, routes, target);
    };
}
export const Get = createMethodDecorator('GET');
export const Post = createMethodDecorator('POST');
export const Put = createMethodDecorator('PUT');
export const Patch = createMethodDecorator('PATCH');
export const Delete = createMethodDecorator('DELETE');
export const Options = createMethodDecorator('OPTIONS');
// ─── Router ────────────────────────────────────────────────
export class Router {
    routes = [];
    globalMiddleware = [];
    /** Clear registered routes and global middleware */
    reset() {
        this.routes = [];
        this.globalMiddleware = [];
        return this;
    }
    /** Register a global middleware (runs on every route) */
    use(middleware) {
        this.globalMiddleware.push(middleware);
        return this;
    }
    /** Manually register a route */
    add(method, path, handler, middleware = []) {
        this.routes.push({ method, path, handler, middleware });
        return this;
    }
    // Shorthand methods
    get(path, handler, middleware) { return this.add('GET', path, handler, middleware); }
    post(path, handler, middleware) { return this.add('POST', path, handler, middleware); }
    put(path, handler, middleware) { return this.add('PUT', path, handler, middleware); }
    patch(path, handler, middleware) { return this.add('PATCH', path, handler, middleware); }
    delete(path, handler, middleware) { return this.add('DELETE', path, handler, middleware); }
    all(path, handler, middleware) { return this.add('ALL', path, handler, middleware); }
    /** Register all routes from a decorator-based controller class */
    registerController(ControllerClass) {
        const instance = new ControllerClass();
        const prefix = Reflect.getMetadata(CONTROLLER_PREFIX, ControllerClass) ?? '';
        const ctrlMw = Reflect.getMetadata(CONTROLLER_MIDDLEWARE, ControllerClass) ?? [];
        const routes = Reflect.getMetadata(ROUTE_DEFINITIONS, ControllerClass.prototype) ?? [];
        for (const route of routes) {
            const fullPath = `${prefix}${route.path}`.replace(/\/+/g, '/');
            const handler = instance[route.handlerKey]
                .bind(instance);
            this.routes.push({
                method: route.method,
                path: fullPath,
                handler,
                middleware: [...ctrlMw, ...route.middleware],
            });
        }
        return this;
    }
    /** Mount all routes onto a server adapter */
    mount(server) {
        // Apply global middleware first
        for (const mw of this.globalMiddleware) {
            server.applyMiddleware(mw);
        }
        // Register all routes
        for (const route of this.routes) {
            server.registerRoute(route);
        }
    }
    /** Get all registered routes (useful for forge routes:list) */
    list() {
        return [...this.routes];
    }
}
// ─── Global router instance ────────────────────────────────
export const router = new Router();
//# sourceMappingURL=index.js.map