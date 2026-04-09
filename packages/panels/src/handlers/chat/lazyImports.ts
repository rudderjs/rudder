/* eslint-disable @typescript-eslint/no-explicit-any */

let _ai: { agent: any; toolDefinition: any; z: any; PauseLoopForClientTools: any } | undefined

export async function loadAi() {
  if (!_ai) {
    const ai  = await import(/* @vite-ignore */ '@rudderjs/ai') as any
    const zod = await import(/* @vite-ignore */ 'zod') as any
    _ai = {
      agent:          ai.agent,
      toolDefinition: ai.toolDefinition,
      z:              zod.z,
      PauseLoopForClientTools: ai.PauseLoopForClientTools,
    }
  }
  return _ai!
}

export async function loadLive() {
  const mod = await import(/* @vite-ignore */ '@rudderjs/live') as any
  return mod.Live as {
    readMap(docName: string, mapName: string): Record<string, unknown>
    readText(docName: string): string
    updateMap(docName: string, mapName: string, field: string, value: unknown): Promise<void>
    editText(docName: string, operation: unknown, aiCursor?: { name: string; color: string }): boolean
    editBlock(docName: string, blockType: string, blockIndex: number, field: string, value: unknown): boolean
    insertBlock(docName: string, blockType: string, blockData: Record<string, unknown>, position?: number): boolean
    removeBlock(docName: string, blockType: string, blockIndex: number): boolean
    rewriteText(docName: string, newText: string, aiCursor?: { name: string; color: string }): boolean
    clearAiAwareness(docName: string): void
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */
