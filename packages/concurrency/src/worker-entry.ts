import { parentPort } from 'node:worker_threads'

if (!parentPort) {
  throw new Error('[Rudder Concurrency] worker-entry.ts must be run inside a Worker thread.')
}

parentPort.on('message', async (msg: { id: number; fnSource: string }) => {
  try {
    // Wrap the function source in an async IIFE and evaluate it
    // eslint-disable-next-line no-eval
    const fn = new Function(`return (${msg.fnSource})`)() as () => unknown
    const result = await fn()
    parentPort!.postMessage({ id: msg.id, result })
  } catch (err) {
    parentPort!.postMessage({
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
})
