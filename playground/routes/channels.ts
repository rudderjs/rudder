import { ws } from '@boostkit/ws'

// Private channel — only the owner can subscribe.
// The client sends a token (e.g. a JWT or session value) with the subscribe message.
ws.auth('private-user.*', async (req, channel) => {
  // Example: parse a userId from a cookie or Authorization header
  // const userId = parseUserIdFromCookies(req.headers.cookie)
  // return userId === channel.split('.')[1]
  return true  // allow all for demo
})

// Presence channel — auth + member info for member tracking.
ws.auth('presence-room.*', async (_req, _channel) => {
  // Return false to deny, or a member-info object to allow
  return { id: 'demo-user', name: 'Demo User' }
})
