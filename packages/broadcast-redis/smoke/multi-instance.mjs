#!/usr/bin/env node
/**
 * Multi-instance broadcast-redis smoke.
 *
 * Spawns two child Node processes, each running its own WebSocket server
 * (`initWsServer`) backed by the SAME Redis pub/sub instance. The parent:
 *   1. opens a WS client to instance A and subscribes to a channel
 *   2. asks instance B to `broadcast()` on that channel
 *   3. asserts the WS client on A receives the message
 *
 * This is the missing end-to-end coverage from PR #611's test plan:
 * unit tests prove the RedisDriver wiring works against a stub, but the
 * cross-process delivery path goes through a real Redis. Run this before
 * shipping any change that touches the broadcast driver contract.
 *
 * Usage:
 *   REDIS_URL=redis://127.0.0.1:6379 node smoke/multi-instance.mjs
 *
 * Exit codes:
 *   0 — message delivered cross-instance ✓
 *   1 — Redis unreachable, child crashed, or assertion failed
 *   2 — Redis unreachable BEFORE we even started (skipped, not a failure)
 */

import { fork }            from 'node:child_process'
import { fileURLToPath }   from 'node:url'
import { dirname, resolve } from 'node:path'
import http                from 'node:http'
import { WebSocket }       from 'ws'

import { initWsServer, getUpgradeHandler, broadcast, resetBroadcast } from '@rudderjs/broadcast'
import { RedisDriver }                                                from '@rudderjs/broadcast-redis'
import { resolveIoredisClass }                                        from '@rudderjs/support'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

// ─── Worker mode ───────────────────────────────────────────

if (process.argv.includes('--worker')) {
  await runWorker()
}
else {
  await runParent()
}

// ─── Worker ────────────────────────────────────────────────

async function runWorker() {
  const driver = new RedisDriver({ redis: REDIS_URL })
  initWsServer({ driver })

  const server  = http.createServer()
  const handler = getUpgradeHandler('/ws')
  server.on('upgrade', handler)

  await new Promise((r) => server.listen(0, r))
  const port = server.address().port

  process.send?.({ type: 'ready', port })

  process.on('message', async (msg) => {
    if (msg.type === 'broadcast') {
      await broadcast(msg.channel, msg.event, msg.data)
      process.send?.({ type: 'broadcast-done' })
    } else if (msg.type === 'shutdown') {
      resetBroadcast()
      await new Promise((r) => server.close(() => r()))
      process.exit(0)
    }
  })

  process.on('SIGTERM', () => process.exit(0))
}

// ─── Parent ────────────────────────────────────────────────

async function runParent() {
  log('checking Redis at', REDIS_URL)
  if (!await pingRedis()) {
    log(`SKIPPED — Redis not reachable at ${REDIS_URL}. Start a local redis (e.g. \`docker run --rm -p 6379:6379 redis\`) and retry.`)
    process.exit(2)
  }
  log('Redis reachable ✓')

  log('spawning two worker processes...')
  const [a, b] = await Promise.all([spawnWorker('A'), spawnWorker('B')])
  log(`worker A: pid=${a.proc.pid} port=${a.port}`)
  log(`worker B: pid=${b.proc.pid} port=${b.port}`)

  // Give the Redis subscription a moment to settle.
  await sleep(200)

  let assertionPassed = false
  let exitCode        = 1

  try {
    log('connecting WS client to worker A, subscribing to "smoke-chan"...')
    const { ws, waitFor } = await connectAndSubscribe(a.port, 'smoke-chan')

    log('asking worker B to broadcast on "smoke-chan"...')
    const broadcastAck = onceMessage(b.proc, 'broadcast-done')
    b.proc.send({
      type:    'broadcast',
      channel: 'smoke-chan',
      event:   'hello-cluster',
      data:    { from: 'worker-B', ts: Date.now() },
    })
    await broadcastAck

    log('waiting for WS client on A to receive the event...')
    const received = await waitFor(
      (m) => m.type === 'event' && m.channel === 'smoke-chan',
      3000,
    )

    if (received.event === 'hello-cluster' && received.data?.from === 'worker-B') {
      log('✓ cross-instance fan-out works — WS client on A received B\'s broadcast')
      assertionPassed = true
      exitCode = 0
    } else {
      log('✗ received message but payload did not match:', received)
    }

    try { ws.close() } catch {}
  } catch (err) {
    log('✗ assertion failed:', err?.message ?? err)
  } finally {
    log('shutting down workers...')
    a.proc.send({ type: 'shutdown' })
    b.proc.send({ type: 'shutdown' })
    await Promise.race([
      Promise.all([waitForExit(a.proc), waitForExit(b.proc)]),
      sleep(2000).then(() => {
        try { a.proc.kill('SIGTERM') } catch {}
        try { b.proc.kill('SIGTERM') } catch {}
      }),
    ])
    log(assertionPassed ? 'SMOKE PASSED' : 'SMOKE FAILED')
    process.exit(exitCode)
  }
}

// ─── Helpers ───────────────────────────────────────────────

function log(...args) {
  console.log('[smoke]', ...args)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function pingRedis() {
  let RedisClass
  try {
    RedisClass = resolveIoredisClass(await import('ioredis'))
  } catch (err) {
    log('ioredis not installed:', err.message)
    return false
  }
  const client = new RedisClass(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0 })
  try {
    await client.connect()
    const pong = await client.ping()
    return pong === 'PONG'
  } catch {
    return false
  } finally {
    try { client.disconnect() } catch {}
  }
}

function spawnWorker(label) {
  return new Promise((resolveSpawn, reject) => {
    const proc = fork(resolve(__dirname, 'multi-instance.mjs'), ['--worker'], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env:   { ...process.env, REDIS_URL, WORKER_LABEL: label },
    })
    const timer = setTimeout(() => reject(new Error(`worker ${label} did not become ready in 5s`)), 5000)
    proc.once('message', (msg) => {
      if (msg.type === 'ready') {
        clearTimeout(timer)
        resolveSpawn({ proc, port: msg.port })
      }
    })
    proc.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`worker ${label} exited prematurely with code ${code}`))
    })
  })
}

function onceMessage(proc, type) {
  return new Promise((resolveMsg, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 3000)
    const handler = (msg) => {
      if (msg.type === type) {
        clearTimeout(timer)
        proc.off('message', handler)
        resolveMsg(msg)
      }
    }
    proc.on('message', handler)
  })
}

function waitForExit(proc) {
  return new Promise((r) => proc.once('exit', () => r()))
}

async function connectAndSubscribe(port, channel) {
  const ws  = new WebSocket(`ws://localhost:${port}/ws`)
  const buf = []
  const waiters = []

  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw))
    const matched = waiters.findIndex((w) => w.predicate(m))
    if (matched !== -1) {
      const [w] = waiters.splice(matched, 1)
      clearTimeout(w.timer)
      w.resolveMsg(m)
    } else {
      buf.push(m)
    }
  })

  await new Promise((r, j) => {
    ws.once('open', r)
    ws.once('error', j)
  })

  // Consume 'connected'
  await waitNext((m) => m.type === 'connected')
  ws.send(JSON.stringify({ type: 'subscribe', channel }))
  await waitNext((m) => m.type === 'subscribed' && m.channel === channel)

  return {
    ws,
    waitFor: (predicate, timeoutMs = 3000) => waitNext(predicate, timeoutMs),
  }

  function waitNext(predicate, timeoutMs = 3000) {
    const buffered = buf.findIndex((m) => predicate(m))
    if (buffered !== -1) {
      const [m] = buf.splice(buffered, 1)
      return Promise.resolve(m)
    }
    return new Promise((resolveMsg, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.indexOf(entry)
        if (idx !== -1) waiters.splice(idx, 1)
        reject(new Error('timeout waiting for matching WS message'))
      }, timeoutMs)
      const entry = { predicate, resolveMsg, timer }
      waiters.push(entry)
    })
  }
}
