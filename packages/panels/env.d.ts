/// <reference types="vike/types" />

interface ImportMeta {
  readonly env: {
    readonly SSR: boolean
    readonly [key: string]: unknown
  }
}
