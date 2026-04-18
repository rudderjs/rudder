import { Passport } from '../Passport.js'
import type { OAuthClient } from '../models/OAuthClient.js'
import type { DeviceCode }  from '../models/DeviceCode.js'
import { clientHelpers, deviceCodeHelpers } from '../models/helpers.js'
import { issueTokens, type IssuedTokens } from './issue-tokens.js'
import { OAuthError } from './authorization-code.js'

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

  const { randomBytes } = await import('node:crypto')
  const deviceCode = randomBytes(32).toString('hex')
  const userCode   = await generateUserCode()
  const scopes     = params.scope ? params.scope.split(' ').filter(Boolean) : []
  const expiresAt  = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

  await DeviceCodeCls.create({
    clientId:   params.clientId,
    deviceCode,
    userCode,
    scopes:     JSON.stringify(scopes),
    userId:     null,
    approved:   null,
    expiresAt,
    lastPolledAt: null,
  } as Record<string, unknown>)

  return {
    device_code:      deviceCode,
    user_code:        userCode,
    verification_uri: params.verificationUri,
    verification_uri_complete: `${params.verificationUri}?user_code=${userCode}`,
    expires_in:       15 * 60, // 15 minutes in seconds
    interval:         5,       // poll every 5 seconds
  }
}

// ─── User Approval ────────────────────────────────────────

/**
 * Step 2: User approves or denies the device (on the verification page).
 */
export async function approveDeviceCode(userCode: string, userId: string, approved: boolean): Promise<void> {
  const DeviceCodeCls = await Passport.deviceCodeModel()
  const device = await DeviceCodeCls.where('userCode', userCode).first() as DeviceCode | null
  if (!device) {
    throw new OAuthError('invalid_request', 'Device code not found.')
  }
  if (deviceCodeHelpers.isExpired(device as any)) {
    throw new OAuthError('expired_token', 'Device code has expired.')
  }
  if (!deviceCodeHelpers.isPending(device as any)) {
    throw new OAuthError('invalid_request', 'Device code has already been used.')
  }

  await DeviceCodeCls.update((device as any).id as string, {
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
  const device = await DeviceCodeCls.where('deviceCode', params.deviceCode).first() as DeviceCode | null
  if (!device) {
    throw new OAuthError('invalid_grant', 'Device code not found.')
  }
  if (device.clientId !== params.clientId) {
    throw new OAuthError('invalid_grant', 'Device code was not issued to this client.')
  }
  if (deviceCodeHelpers.isExpired(device as any)) {
    return { status: 'expired_token' }
  }

  // Rate limiting: enforce 5-second interval
  if (device.lastPolledAt) {
    const elapsed = Date.now() - new Date(device.lastPolledAt).getTime()
    if (elapsed < 5000) {
      return { status: 'slow_down' }
    }
  }

  // Update last polled time
  await DeviceCodeCls.update((device as any).id as string, {
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
  await DeviceCodeCls.delete((device as any).id as string)

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
