import 'reflect-metadata'

const NAME_KEY = Symbol('mcp:name')
const VERSION_KEY = Symbol('mcp:version')
const INSTRUCTIONS_KEY = Symbol('mcp:instructions')
const DESCRIPTION_KEY = Symbol('mcp:description')
const INJECT_KEY = Symbol('mcp:inject')

export function Name(name: string): ClassDecorator {
  return (target) => { Reflect.defineMetadata(NAME_KEY, name, target) }
}

export function Version(version: string): ClassDecorator {
  return (target) => { Reflect.defineMetadata(VERSION_KEY, version, target) }
}

export function Instructions(instructions: string): ClassDecorator {
  return (target) => { Reflect.defineMetadata(INSTRUCTIONS_KEY, instructions, target) }
}

export function Description(description: string): ClassDecorator {
  return (target) => { Reflect.defineMetadata(DESCRIPTION_KEY, description, target) }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getServerMetadata(target: Function): { name: string | undefined; version: string | undefined; instructions: string | undefined } {
  return {
    name: Reflect.getMetadata(NAME_KEY, target) as string | undefined,
    version: Reflect.getMetadata(VERSION_KEY, target) as string | undefined,
    instructions: Reflect.getMetadata(INSTRUCTIONS_KEY, target) as string | undefined,
  }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getDescription(target: Function): string | undefined {
  return Reflect.getMetadata(DESCRIPTION_KEY, target) as string | undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InjectToken = (new (...args: any[]) => unknown) | string | symbol

/**
 * Marks a method (typically `handle`) as wanting DI-resolved parameters beyond
 * the first one. Pass the tokens explicitly — one per extra parameter:
 *
 * ```ts
 * @Handle(GreetingService, Logger)
 * async handle(input, greeter: GreetingService, logger: Logger) { ... }
 * ```
 *
 * If called with no arguments, the runtime falls back to `design:paramtypes`
 * metadata (which requires `emitDecoratorMetadata: true` AND a build tool that
 * honours it — plain `tsc` does, but esbuild/Vite typically do not).
 */
export function Handle(...tokens: InjectToken[]): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(INJECT_KEY, tokens, target, propertyKey)
  }
}

export function getInjectTokens(target: object, propertyKey: string | symbol): InjectToken[] | undefined {
  return Reflect.getMetadata(INJECT_KEY, target, propertyKey) as InjectToken[] | undefined
}

export type { InjectToken }
