import { Passport } from '../Passport.js'
import type { AccessToken }  from '../models/AccessToken.js'
import type { RefreshToken } from '../models/RefreshToken.js'
import type { AuthCode }     from '../models/AuthCode.js'
import type { DeviceCode }   from '../models/DeviceCode.js'

/**
 * Remove expired and revoked tokens from the database.
 * Returns counts of purged records.
 */
export async function purgeTokens(): Promise<{
  accessTokens:  number
  refreshTokens: number
  authCodes:     number
  deviceCodes:   number
}> {
  const now = new Date()

  const AccessTokenCls  = await Passport.tokenModel()
  const RefreshTokenCls = await Passport.refreshTokenModel()
  const AuthCodeCls     = await Passport.authCodeModel()
  const DeviceCodeCls   = await Passport.deviceCodeModel()

  // Purge expired/revoked access tokens
  const expiredAccess = await AccessTokenCls.query()
    .where('expiresAt', '<', now)
    .orWhere('revoked', true)
    .get() as AccessToken[]
  for (const t of expiredAccess) {
    await AccessTokenCls.delete((t as any).id as string)
  }

  // Purge expired/revoked refresh tokens
  const expiredRefresh = await RefreshTokenCls.query()
    .where('expiresAt', '<', now)
    .orWhere('revoked', true)
    .get() as RefreshToken[]
  for (const t of expiredRefresh) {
    await RefreshTokenCls.delete((t as any).id as string)
  }

  // Purge expired auth codes
  const expiredCodes = await AuthCodeCls.query()
    .where('expiresAt', '<', now)
    .get() as AuthCode[]
  for (const c of expiredCodes) {
    await AuthCodeCls.delete((c as any).id as string)
  }

  // Purge expired device codes
  const expiredDevices = await DeviceCodeCls.query()
    .where('expiresAt', '<', now)
    .get() as DeviceCode[]
  for (const d of expiredDevices) {
    await DeviceCodeCls.delete((d as any).id as string)
  }

  return {
    accessTokens:  expiredAccess.length,
    refreshTokens: expiredRefresh.length,
    authCodes:     expiredCodes.length,
    deviceCodes:   expiredDevices.length,
  }
}
