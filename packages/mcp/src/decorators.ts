import 'reflect-metadata'

const NAME_KEY = Symbol('mcp:name')
const VERSION_KEY = Symbol('mcp:version')
const INSTRUCTIONS_KEY = Symbol('mcp:instructions')
const DESCRIPTION_KEY = Symbol('mcp:description')

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

export function getServerMetadata(target: Function): { name: string | undefined; version: string | undefined; instructions: string | undefined } {
  return {
    name: Reflect.getMetadata(NAME_KEY, target) as string | undefined,
    version: Reflect.getMetadata(VERSION_KEY, target) as string | undefined,
    instructions: Reflect.getMetadata(INSTRUCTIONS_KEY, target) as string | undefined,
  }
}

export function getDescription(target: Function): string | undefined {
  return Reflect.getMetadata(DESCRIPTION_KEY, target) as string | undefined
}
