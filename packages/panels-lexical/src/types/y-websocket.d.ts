// Module augmentation — adds missing members to y-websocket's WebsocketProvider.
// The library extends EventEmitter but its TypeScript types are incomplete.

declare module 'y-websocket' {
  interface WebsocketProvider {
    once(event: 'synced', callback: () => void): void
    once(event: string, callback: (...args: unknown[]) => void): void
    on(event: string, callback: (...args: unknown[]) => void): void
    off(event: string, callback: (...args: unknown[]) => void): void
    connect(): void
    disconnect(): void
    destroy(): void
  }
}
