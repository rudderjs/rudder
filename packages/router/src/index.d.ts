import 'reflect-metadata';
import type { ServerAdapter, RouteDefinition, RouteHandler, MiddlewareHandler, HttpMethod } from '@rudderjs/core/server';
/** Mark a class as a controller with an optional route prefix */
export declare function Controller(prefix?: string): ClassDecorator;
/** Attach middleware to a controller class or route method */
export declare function Middleware(middleware: MiddlewareHandler[]): ClassDecorator & MethodDecorator;
export declare const Get: (path?: string) => MethodDecorator;
export declare const Post: (path?: string) => MethodDecorator;
export declare const Put: (path?: string) => MethodDecorator;
export declare const Patch: (path?: string) => MethodDecorator;
export declare const Delete: (path?: string) => MethodDecorator;
export declare const Options: (path?: string) => MethodDecorator;
export declare class Router {
    private routes;
    private globalMiddleware;
    /** Clear registered routes and global middleware */
    reset(): this;
    /** Register a global middleware (runs on every route) */
    use(middleware: MiddlewareHandler): this;
    /** Manually register a route */
    add(method: HttpMethod, path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): this;
    get(path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): this;
    post(path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): this;
    put(path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): this;
    patch(path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): this;
    delete(path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): this;
    all(path: string, handler: RouteHandler, middleware?: MiddlewareHandler[]): this;
    /** Register all routes from a decorator-based controller class */
    registerController(ControllerClass: new () => object): this;
    /** Mount all routes onto a server adapter */
    mount(server: ServerAdapter): void;
    /** Get all registered routes (useful for rudderjs routes:list) */
    list(): RouteDefinition[];
}
export declare const router: Router;
//# sourceMappingURL=index.d.ts.map