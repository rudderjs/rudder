import 'reflect-metadata'

const NAME_KEY = Symbol('mcp:name')
const VERSION_KEY = Symbol('mcp:version')
const INSTRUCTIONS_KEY = Symbol('mcp:instructions')
const DESCRIPTION_KEY = Symbol('mcp:description')
const INJECT_KEY = Symbol('mcp:inject')

// Tool annotations (MCP spec hints — clients use these to decide auto-approval, batching, sandboxing)
const READ_ONLY_KEY     = Symbol('mcp:readOnly')
const DESTRUCTIVE_KEY   = Symbol('mcp:destructive')
const IDEMPOTENT_KEY    = Symbol('mcp:idempotent')
const OPEN_WORLD_KEY    = Symbol('mcp:openWorld')

// Resource annotations
const AUDIENCE_KEY      = Symbol('mcp:audience')
const PRIORITY_KEY      = Symbol('mcp:priority')
const LAST_MODIFIED_KEY = Symbol('mcp:lastModified')

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

// ─── Tool annotations (MCP spec) ─────────────────────────
//
// Per the MCP spec, tools may carry behavior hints that clients (Claude
// Desktop, Cursor, etc.) use to decide whether to auto-approve a call, batch
// it, or sandbox it. The hints are advisory — clients still apply their own
// policy. Both `true` and `false` are meaningful (vs. omitted), so each
// decorator accepts an explicit value with a default of `true`.
//
// Spec reference: https://modelcontextprotocol.io/specification

/** Tool does not modify state. */
export function IsReadOnly(value = true): ClassDecorator {
  return (target) => { Reflect.defineMetadata(READ_ONLY_KEY, value, target) }
}

/** Tool may perform destructive updates. */
export function IsDestructive(value = true): ClassDecorator {
  return (target) => { Reflect.defineMetadata(DESTRUCTIVE_KEY, value, target) }
}

/** Repeated calls with the same input have no additional effect. */
export function IsIdempotent(value = true): ClassDecorator {
  return (target) => { Reflect.defineMetadata(IDEMPOTENT_KEY, value, target) }
}

/** Tool interacts with external systems (network, filesystem outside the server). */
export function IsOpenWorld(value = true): ClassDecorator {
  return (target) => { Reflect.defineMetadata(OPEN_WORLD_KEY, value, target) }
}

export interface ToolAnnotations {
  readOnlyHint?:    boolean
  destructiveHint?: boolean
  idempotentHint?:  boolean
  openWorldHint?:   boolean
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getToolAnnotations(target: Function): ToolAnnotations | undefined {
  const a: ToolAnnotations = {}
  const ro = Reflect.getMetadata(READ_ONLY_KEY,   target) as boolean | undefined
  const de = Reflect.getMetadata(DESTRUCTIVE_KEY, target) as boolean | undefined
  const id = Reflect.getMetadata(IDEMPOTENT_KEY,  target) as boolean | undefined
  const ow = Reflect.getMetadata(OPEN_WORLD_KEY,  target) as boolean | undefined
  if (ro !== undefined) a.readOnlyHint    = ro
  if (de !== undefined) a.destructiveHint = de
  if (id !== undefined) a.idempotentHint  = id
  if (ow !== undefined) a.openWorldHint   = ow
  return Object.keys(a).length > 0 ? a : undefined
}

// ─── Resource annotations (MCP spec) ─────────────────────

export type AudienceRole = 'user' | 'assistant'

/** Intended audience(s). One or both of `'user'`, `'assistant'`. */
export function Audience(...roles: AudienceRole[]): ClassDecorator {
  if (roles.length === 0) throw new Error('@Audience requires at least one role')
  return (target) => { Reflect.defineMetadata(AUDIENCE_KEY, roles, target) }
}

/** Importance score, 0..1. */
export function Priority(value: number): ClassDecorator {
  if (value < 0 || value > 1 || Number.isNaN(value)) {
    throw new Error(`@Priority must be between 0 and 1, got ${value}`)
  }
  return (target) => { Reflect.defineMetadata(PRIORITY_KEY, value, target) }
}

/** Last-modified timestamp. ISO 8601 string or Date. */
export function LastModified(value: string | Date): ClassDecorator {
  const iso = value instanceof Date ? value.toISOString() : value
  return (target) => { Reflect.defineMetadata(LAST_MODIFIED_KEY, iso, target) }
}

export interface ResourceAnnotations {
  audience?:     AudienceRole[]
  priority?:     number
  lastModified?: string
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function getResourceAnnotations(target: Function): ResourceAnnotations | undefined {
  const a: ResourceAnnotations = {}
  const aud = Reflect.getMetadata(AUDIENCE_KEY,      target) as AudienceRole[] | undefined
  const pri = Reflect.getMetadata(PRIORITY_KEY,      target) as number         | undefined
  const lm  = Reflect.getMetadata(LAST_MODIFIED_KEY, target) as string         | undefined
  if (aud !== undefined) a.audience     = aud
  if (pri !== undefined) a.priority     = pri
  if (lm  !== undefined) a.lastModified = lm
  return Object.keys(a).length > 0 ? a : undefined
}
