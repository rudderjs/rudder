import { Passport } from '../Passport.js'
import type { OAuthClient } from '../models/OAuthClient.js'
import type { DeviceCode }  from '../models/DeviceCode.js'
import { clientHelpers, deviceCodeHelpers } from '../models/helpers.js'
import { hashDeviceSecret } from '../device-code-secret.js'
import { issueTokens, type IssuedTokens } from './issue-tokens.js'
import { OAuthError, validateScopes } from './authorization-code.js'
import { parseScopes } from './parse-scopes.js'

/**
 * Initial polling interval for new device-code rows (RFC 8628 §3.5).
 * Server escalates by 5s on each `slow_down` response, capped at
 * `Passport.deviceMaxIntervalSeconds()` (default 60). RFC 8628 §3.5 doesn't
 * specify a cap; we add one to keep degenerate clients from pushing the
 * interval to absurd values, with the cap exposed to the operator so a
 * niche flow (machine-only daemons, integration tests) can override it.
 */
const INITIAL_INTERVAL_SECONDS = 5

// ─── Device Authorization Request ─────────────────────────

export interface DeviceAuthorizationResponse {
  device_code:                string
  user_code:                  string
  verification_uri:           string
  verification_uri_complete?: string
  expires_in:                 number
  interval:                   number
}

/**
 * Step 1: Device requests authorization codes.
 * Returns device_code + user_code for the user to enter.
 */
export async function requestDeviceCode(params: {
  clientId: string
  scope?:   string
  verificationUri: string
}): Promise<DeviceAuthorizationResponse> {
  const ClientCls     = await Passport.clientModel()
  const DeviceCodeCls = await Passport.deviceCodeModel()

  const client = await ClientCls.where('id', params.clientId).first() as OAuthClient | null
  if (!client || client.revoked) {
    throw new OAuthError('invalid_client', 'Client not found.')
  }

  if (!clientHelpers.hasGrantType(client, 'urn:ietf:params:oauth:grant-type:device_code')) {
    throw new OAuthError('unauthorized_client', 'Client is not authorized for device authorization grant.')
  }

  const scopes     = parseScopes(params.scope)
  validateScopes(client, scopes)

  const { randomBytes } = await import('node:crypto')
  const deviceCode = randomBytes(32).toString('hex')
  const userCode   = await generateUserCode()
  const expiresAt  = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

  // Hash both codes at rest (M4 / RFC 8628 §6.1) — a DB read leak should
  // not yield usable codes. The plaintext is returned to the client below
  // and never persisted.
  const [deviceCodeHash, userCodeHash] = await Promise.all([
    hashDeviceSecret(deviceCode),
    hashDeviceSecret(userCode),
  ])

  await DeviceCodeCls.create({
    clientId:       params.clientId,
    deviceCodeHash,
    userCodeHash,
    scopes:         JSON.stringify(scopes),
    userId:         null,
    approved:       null,
    interval:       INITIAL_INTERVAL_SECONDS,
    expiresAt,
    lastPolledAt:   null,
  } as Record<string, unknown>)

  return {
    device_code:      deviceCode,
    user_code:        userCode,
    verification_uri: params.verificationUri,
    verification_uri_complete: `${params.verificationUri}?user_code=${userCode}`,
    expires_in:       15 * 60, // 15 minutes in seconds
    interval:         INITIAL_INTERVAL_SECONDS,
  }
}

// ─── User Approval ────────────────────────────────────────

/**
 * Step 2: User approves or denies the device (on the verification page).
 */
export async function approveDeviceCode(userCode: string, userId: string, approved: boolean): Promise<void> {
  const DeviceCodeCls = await Passport.deviceCodeModel()
  // M4 — look up by hash, not the plaintext the user typed. Same lookup
  // surface an attacker would attempt against; the hash makes the column
  // useless to an attacker who got a DB read.
  const userCodeHash = await hashDeviceSecret(userCode)
  const device = await DeviceCodeCls.where('userCodeHash', userCodeHash).first() as DeviceCode | null
  if (!device) {
    throw new OAuthError('invalid_request', 'Device code not found.')
  }
  if (deviceCodeHelpers.isExpired(device)) {
    throw new OAuthError('expired_token', 'Device code has expired.')
  }
  if (!deviceCodeHelpers.isPending(device)) {
    throw new OAuthError('invalid_request', 'Device code has already been used.')
  }

  await DeviceCodeCls.update(device.id, {
    userId,
    approved,
  } as Record<string, unknown>)
}

// ─── Device Token Polling ─────────────────────────────────

export type DevicePollResult =
  | { status: 'authorized'; tokens: IssuedTokens }
  | { status: 'authorization_pending' }
  /**
   * RFC 8628 §3.5: when the device polls faster than the current interval,
   * the server returns `slow_down` AND increments the required interval by
   * 5 seconds (capped at 60). The new interval is included in the result so
   * the route handler can forward it on the wire — well-behaved clients
   * use it directly instead of guessing at the new value.
   */
  | { status: 'slow_down'; interval: number }
  | { status: 'access_denied' }
  | { status: 'expired_token' }

/**
 * Step 3: Device polls for tokens using the device_code.
 */
export async function pollDeviceCode(params: {
  grantType:  string
  deviceCode: string
  clientId:   string
}): Promise<DevicePollResult> {
  if (params.grantType !== 'urn:ietf:params:oauth:grant-type:device_code') {
    throw new OAuthError('unsupported_grant_type', 'Expected grant_type=urn:ietf:params:oauth:grant-type:device_code.')
  }

  const DeviceCodeCls = await Passport.deviceCodeModel()
  // M4 — hash the supplied plaintext and look up by hash.
  const deviceCodeHash = await hashDeviceSecret(params.deviceCode)
  const device = await DeviceCodeCls.where('deviceCodeHash', deviceCodeHash).first() as DeviceCode | null
  if (!device) {
    throw new OAuthError('invalid_grant', 'Device code not found.')
  }
  if (device.clientId !== params.clientId) {
    throw new OAuthError('invalid_grant', 'Device code was not issued to this client.')
  }
  if (deviceCodeHelpers.isExpired(device)) {
    return { status: 'expired_token' }
  }

  // Rate limiting (RFC 8628 §3.5). Enforce against the per-row `interval`
  // (defaults to 5s, escalates by 5s per slow_down, capped at 60s).
  //
  // The check + the `lastPolledAt` bump are a SINGLE conditional UPDATE so that:
  //   (a) two concurrent polls can't both read a stale `lastPolledAt` and both
  //       slip past the gate — exactly one matches (count 1) and proceeds, the
  //       rest match 0 and are told to slow down; and
  //   (b) the back-off clock anchors to the last ALLOWED poll — a throttled poll
  //       does NOT advance `lastPolledAt` (the row didn't match), so a client
  //       hammering the endpoint can't keep pushing the window forward.
  // The first poll (lastPolledAt null) is never throttled, per RFC 8628.
  const now = new Date()
  if (device.lastPolledAt === null || device.lastPolledAt === undefined) {
    await DeviceCodeCls.update(device.id, { lastPolledAt: now } as Record<string, unknown>)
  } else {
    const threshold = new Date(now.getTime() - device.interval * 1000)
    const allowed = await DeviceCodeCls.query()
      .where('id', device.id)
      .where('lastPolledAt', '<=', threshold)
      .updateAll({ lastPolledAt: now } as Record<string, unknown>)
    if (allowed === 0) {
      const nextInterval = Math.min(device.interval + 5, Passport.deviceMaxIntervalSeconds())
      if (nextInterval !== device.interval) {
        await DeviceCodeCls.update(device.id, { interval: nextInterval } as Record<string, unknown>)
      }
      return { status: 'slow_down', interval: nextInterval }
    }
  }

  if (deviceCodeHelpers.isPending(device)) {
    return { status: 'authorization_pending' }
  }

  if (deviceCodeHelpers.isDenied(device)) {
    return { status: 'access_denied' }
  }

  // Atomically claim the device code by deleting the row in a single SQL
  // statement conditioned on `approved = true`. Only one of N concurrent
  // pollers will see `claimed === 1`; the rest see 0 and report invalid_grant
  // (same surface the route returns when the device row was never found).
  // Without this guard the prior read-approve-issue-delete sequence allowed
  // two concurrent polls of an approved code to both mint token pairs.
  const claimed = await DeviceCodeCls
    .where('id', device.id)
    .where('approved', true)
    .deleteAll()
  if (claimed === 0) {
    throw new OAuthError('invalid_grant', 'Device code has already been used.')
  }

  // Issue tokens using the device data we already loaded — the row is gone
  // from the DB now, but `device` is the in-memory snapshot from before the
  // claim, which is exactly what we want for the response.
  const tokens = await issueTokens({
    userId:   device.userId,
    clientId: params.clientId,
    scopes:   deviceCodeHelpers.getScopes(device),
    includeRefresh: true,
  })

  return { status: 'authorized', tokens }
}

// ─── Helpers ──────────────────────────────────────────────

/** Generate a human-readable user code (8 chars, uppercase, no ambiguous chars). */
async function generateUserCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I, O, 0, 1
  const { randomInt } = await import('node:crypto')
  let code = ''
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-' // XXXX-XXXX format
    code += chars[randomInt(chars.length)]
  }
  return code
}
