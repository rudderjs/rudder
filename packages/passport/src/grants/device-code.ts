import { Passport } from '../Passport.js'
import type { OAuthClient } from '../models/OAuthClient.js'
import type { DeviceCode }  from '../models/DeviceCode.js'
import { clientHelpers, deviceCodeHelpers } from '../models/helpers.js'
import { issueTokens, type IssuedTokens } from './issue-tokens.js'
import { OAuthError, validateScopes } from './authorization-code.js'
import { hashDeviceToken } from './device-code-hash.js'

/** Initial polling interval per RFC 8628 §3.2 (seconds). */
const INITIAL_POLL_INTERVAL_S = 5

/** Per RFC 8628 §3.5: when returning slow_down, increase the interval by 5s. */
const SLOW_DOWN_BUMP_S = 5

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

  // Per RFC 8628 §6.1: store at-rest hashes of the device + user codes; the
  // plaintext only lives in this function's response. A DB dump no longer
  // yields usable in-flight device-flow sessions on its own.
  const deviceCodeHash = await hashDeviceToken(deviceCode)
  const userCodeHash   = await hashDeviceToken(userCode)

  await DeviceCodeCls.create({
    clientId:     params.clientId,
    deviceCode:   deviceCodeHash,
    userCode:     userCodeHash,
    scopes:       JSON.stringify(scopes),
    userId:       null,
    approved:     null,
    expiresAt,
    lastPolledAt: null,
    interval:     INITIAL_POLL_INTERVAL_S,
  } as Record<string, unknown>)

  return {
    device_code:      deviceCode,
    user_code:        userCode,
    verification_uri: params.verificationUri,
    verification_uri_complete: `${params.verificationUri}?user_code=${userCode}`,
    expires_in:       15 * 60, // 15 minutes in seconds
    interval:         INITIAL_POLL_INTERVAL_S,
  }
}

// ─── User Approval ────────────────────────────────────────

/**
 * Step 2: User approves or denies the device (on the verification page).
 */
export async function approveDeviceCode(userCode: string, userId: string, approved: boolean): Promise<void> {
  const DeviceCodeCls = await Passport.deviceCodeModel()
  // Lookup-by-hash — plaintext userCode never leaves this function's local
  // scope. See `device-code-hash.ts` for the threat model.
  const userCodeHash = await hashDeviceToken(userCode)
  const device = await DeviceCodeCls.where('userCode', userCodeHash).first() as DeviceCode | null
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
  | { status: 'slow_down' }
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
  const deviceCodeHash = await hashDeviceToken(params.deviceCode)
  const device = await DeviceCodeCls.where('deviceCode', deviceCodeHash).first() as DeviceCode | null
  if (!device) {
    throw new OAuthError('invalid_grant', 'Device code not found.')
  }
  if (device.clientId !== params.clientId) {
    throw new OAuthError('invalid_grant', 'Device code was not issued to this client.')
  }
  if (deviceCodeHelpers.isExpired(device as any)) {
    return { status: 'expired_token' }
  }

  // Per RFC 8628 §3.5: enforce the per-row polling interval (defaults to 5s
  // on issuance) and bump it by 5s on every slow_down so misbehaving clients
  // back off progressively. Rows persisted before this column existed read
  // back as null/undefined; treat that as the initial 5s interval.
  const interval = device.interval ?? INITIAL_POLL_INTERVAL_S
  if (device.lastPolledAt) {
    const elapsed = Date.now() - new Date(device.lastPolledAt).getTime()
    if (elapsed < interval * 1000) {
      await DeviceCodeCls.update(device.id, {
        interval: interval + SLOW_DOWN_BUMP_S,
      } as any)
      return { status: 'slow_down' }
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
