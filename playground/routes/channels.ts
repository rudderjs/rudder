import { Broadcast } from '@rudderjs/broadcast'

// Private channel — only the owner can subscribe.
Broadcast.channel('private-user.*', async (_req, _channel) => {
  return true  // allow all for demo
})

// Presence channel used by the /ws-demo page.
// Returns member info so the server tracks who is online.
Broadcast.channel('presence-lobby', async (_req) => {
  const id   = `user-${Math.random().toString(36).slice(2, 7)}`
  const name = `User-${id.slice(-3).toUpperCase()}`
  return { id, name }
})

// Presence channel with wildcard for other presence channels.
Broadcast.channel('presence-room.*', async (_req) => {
  return { id: 'demo-user', name: 'Demo User' }
})
