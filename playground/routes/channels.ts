import { ws } from '@boostkit/ws'

// Private channel — only the owner can subscribe.
ws.auth('private-user.*', async (_req, _channel) => {
  return true  // allow all for demo
})

// Presence channel used by the /ws-demo page.
// Returns member info so the server tracks who is online.
ws.auth('presence-lobby', async (_req) => {
  const id   = `user-${Math.random().toString(36).slice(2, 7)}`
  const name = `User-${id.slice(-3).toUpperCase()}`
  return { id, name }
})

// Presence channel with wildcard for other presence channels.
ws.auth('presence-room.*', async (_req) => {
  return { id: 'demo-user', name: 'Demo User' }
})
