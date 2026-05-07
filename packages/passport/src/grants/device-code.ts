import { Passport } from '../Passport.js'
import type { OAuthClient } from '../models/OAuthClient.js'
import type { DeviceCode }  from '../models/DeviceCode.js'
import { clientHelpers, deviceCodeHelpers } from '../models/helpers.js'
import { hashDeviceSecret } from '../device-code-secret.js'
import { issueTokens, type IssuedTokens } from './issue-tokens.js'
import { OAuthError, validateScopes } from './authorization-code.js'

/**
 * Initial polling interval for new device-code rows (RFC 8628 §3.5).
 * Server escalates by 5s on each `slow_down` response, capped at MAX.
 */
const INITIAL_INTERVAL_SECONDS = 5
const MAX_INTERVAL_SECONDS     = 60

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

  if (!clientHelpers.hasGrantType(client as any, 'urn:ietf:params:oauth:grant-type:device_code')) {
    throw new OAuthError('unauthorized_client', 'Client is not authorized for device authorization grant.')
  }

  const scopes     = params.scope ? params.scope.split(' ').filter(Boolean) : []
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
  if (deviceCodeHelpers.isExpired(device as any)) {
    throw new OAuthError('expired_token', 'Device code has expired.')
  }
  if (!deviceCodeHelpers.isPending(device as any)) {
    throw new OAuthError('invalid_request', 'Device code has already been used.')
  }

  await DeviceCodeCls.update(device.id, {
    userId,
    approved,
  } as any)
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
  if (deviceCodeHelpers.isExpired(device as any)) {
    return { status: 'expired_token' }
  }

  // Rate limiting (RFC 8628 §3.5). Enforce against the per-row `interval`
  // (defaults to 5s, escalates by 5s per slow_down, capped at 60s). Persist
  // the new interval so subsequent polls see the escalated value.
  if (device.lastPolledAt) {
    const elapsed = Date.now() - new Date(device.lastPolledAt).getTime()
    if (elapsed < device.interval * 1000) {
      const nextInterval = Math.min(device.interval + 5, MAX_INTERVAL_SECONDS)
      if (nextInterval !== device.interval) {
        await DeviceCodeCls.update(device.id, { interval: nextInterval } as any)
      }
      return { status: 'slow_down', interval: nextInterval }
    }
  }

  // Update last polled time
  await DeviceCodeCls.update(device.id, {
    lastPolledAt: new Date(),
  } as any)

  if (deviceCodeHelpers.isPending(device as any)) {
    return { status: 'authorization_pending' }
  }

  if (deviceCodeHelpers.isDenied(device as any)) {
    return { status: 'access_denied' }
  }

  // Approved — issue tokens
  const tokens = await issueTokens({
    userId:   device.userId,
    clientId: params.clientId,
    scopes:   deviceCodeHelpers.getScopes(device as any),
    includeRefresh: true,
  })

  // Clean up the device code
  await DeviceCodeCls.delete(device.id)

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
