import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  Passport,
  PassportProvider,
  createToken,
  verifyToken,
  unsafeDecodeToken,
  decodeToken,
  OAuthClient,
  AccessToken,
  RefreshToken,
  AuthCode,
  DeviceCode,
  BearerMiddleware,
  RequireBearer,
  scope,
  scopeAny,
  generateKeys,
  createClient,
  resolveClientGrantTypes,
  purgeTokens,
  issueTokens,
  validateAuthorizationRequest,
  issueAuthCode,
  exchangeAuthCode,
  OAuthError,
  clientCredentialsGrant,
  refreshTokenGrant,
  requestDeviceCode,
  approveDeviceCode,
  pollDeviceCode,
  HasApiTokens,
  resetPersonalAccessClient,
  registerPassportRoutes,
  registerPassportWebRoutes,
  registerPassportApiRoutes,
  checkOAuthKeysAtBoot,
} from './index.js'
import { safeCompare } from './grants/safe-compare.js'

describe('checkOAuthKeysAtBoot — keypair fail-fast in production', () => {
  test('returns null when keys are available (nothing to warn about)', () => {
    assert.equal(checkOAuthKeysAtBoot({ keysAvailable: true, isProduction: true, keyPath: 'storage' }), null)
    assert.equal(checkOAuthKeysAtBoot({ keysAvailable: true, isProduction: false, keyPath: 'storage' }), null)
  })

  test('warns (does NOT throw) when keys are missing outside production', () => {
    const msg = checkOAuthKeysAtBoot({ keysAvailable: false, isProduction: false, keyPath: 'storage' })
    assert.ok(typeof msg === 'string')
    assert.match(msg!, /passport:keys/)
    assert.match(msg!, /storage\/oauth-\{private,public\}\.key/)
  })

  test('throws in production when keys are missing (fail-fast deploy)', () => {
    assert.throws(
      () => checkOAuthKeysAtBoot({ keysAvailable: false, isProduction: true, keyPath: 'storage' }),
      (e: unknown) => e instanceof Error && /Refusing to boot in production/.test(e.message),
    )
  })
})

describe('@rudderjs/passport exports', () => {
  test('Passport singleton is exported', () => {
    assert.ok(Passport)
    assert.equal(typeof Passport.tokensCan, 'function')
    assert.equal(typeof Passport.setKeys, 'function')
  })

  test('PassportProvider is a class', () => {
    assert.equal(typeof PassportProvider, 'function')
  })

  test('token helpers are functions', () => {
    assert.equal(typeof createToken, 'function')
    assert.equal(typeof verifyToken, 'function')
    assert.equal(typeof unsafeDecodeToken, 'function')
    // `decodeToken` is kept as a deprecated alias for back-compat — both
    // names must reach the same function.
    assert.equal(decodeToken, unsafeDecodeToken,
      '`decodeToken` must remain an alias for `unsafeDecodeToken`')
  })

  test('models are exported', () => {
    assert.ok(OAuthClient)
    assert.ok(AccessToken)
    assert.ok(RefreshToken)
    assert.ok(AuthCode)
    assert.ok(DeviceCode)
  })

  test('middleware helpers are functions', () => {
    assert.equal(typeof BearerMiddleware, 'function')
    assert.equal(typeof RequireBearer, 'function')
    assert.equal(typeof scope, 'function')
    assert.equal(typeof scopeAny, 'function')
  })

  test('command helpers are functions', () => {
    assert.equal(typeof generateKeys, 'function')
    assert.equal(typeof createClient, 'function')
    assert.equal(typeof resolveClientGrantTypes, 'function')
    assert.equal(typeof purgeTokens, 'function')
  })

  test('grant functions are exported', () => {
    assert.equal(typeof issueTokens, 'function')
    assert.equal(typeof validateAuthorizationRequest, 'function')
    assert.equal(typeof issueAuthCode, 'function')
    assert.equal(typeof exchangeAuthCode, 'function')
    assert.equal(typeof clientCredentialsGrant, 'function')
    assert.equal(typeof refreshTokenGrant, 'function')
    assert.equal(typeof requestDeviceCode, 'function')
    assert.equal(typeof approveDeviceCode, 'function')
    assert.equal(typeof pollDeviceCode, 'function')
  })

  test('OAuthError is a constructable Error subclass', () => {
    const err = new OAuthError('invalid_request', 'bad', 400)
    assert.ok(err instanceof Error)
    assert.equal(err.error, 'invalid_request')
    assert.equal(err.errorDescription, 'bad')
    assert.equal(err.statusCode, 400)
  })

  test('personal access token helpers are exported', () => {
    assert.equal(typeof HasApiTokens, 'function')
    assert.equal(typeof resetPersonalAccessClient, 'function')
  })

  test('registerPassportRoutes is a function', () => {
    assert.equal(typeof registerPassportRoutes, 'function')
  })

  test('registerPassportWebRoutes + registerPassportApiRoutes are functions', () => {
    assert.equal(typeof registerPassportWebRoutes, 'function')
    assert.equal(typeof registerPassportApiRoutes, 'function')
  })
})

describe('Passport Phase 6 customization hooks', () => {
  test('useClientModel / clientModel — override wins, defaults to OAuthClient', async () => {
    Passport.reset()
    assert.equal(await Passport.clientModel(), OAuthClient)

    class CustomClient extends OAuthClient {}
    Passport.useClientModel(CustomClient)
    assert.equal(await Passport.clientModel(), CustomClient)

    Passport.reset()
    assert.equal(await Passport.clientModel(), OAuthClient)
  })

  test('useTokenModel / tokenModel — override wins, defaults to AccessToken', async () => {
    Passport.reset()
    assert.equal(await Passport.tokenModel(), AccessToken)

    class CustomToken extends AccessToken {}
    Passport.useTokenModel(CustomToken)
    assert.equal(await Passport.tokenModel(), CustomToken)

    Passport.reset()
  })

  test('useRefreshTokenModel / useAuthCodeModel / useDeviceCodeModel defaults', async () => {
    Passport.reset()
    assert.equal(await Passport.refreshTokenModel(), RefreshToken)
    assert.equal(await Passport.authCodeModel(),     AuthCode)
    assert.equal(await Passport.deviceCodeModel(),   DeviceCode)
  })

  test('authorizationView stores a custom consent renderer', () => {
    Passport.reset()
    assert.equal(Passport.authorizationViewFn(), null)

    const fn = (_ctx: unknown) => ({ kind: 'view', name: 'consent' })
    Passport.authorizationView(fn)
    assert.equal(Passport.authorizationViewFn(), fn)

    Passport.reset()
    assert.equal(Passport.authorizationViewFn(), null)
  })

  test('ignoreRoutes toggles routesIgnored and short-circuits registerPassportRoutes', () => {
    Passport.reset()
    assert.equal(Passport.routesIgnored(), false)

    Passport.ignoreRoutes()
    assert.equal(Passport.routesIgnored(), true)

    let called = 0
    const fakeRouter = {
      get:    () => { called++ },
      post:   () => { called++ },
      delete: () => { called++ },
    }
    registerPassportRoutes(fakeRouter)
    assert.equal(called, 0, 'no routes registered when ignoreRoutes is set')

    Passport.reset()
  })

  test('registerPassportRoutes honors opts.except to skip route groups', () => {
    Passport.reset()
    const registered: Array<[string, string]> = []
    const fakeRouter = {
      get:    (p: string) => { registered.push(['GET',    p]) },
      post:   (p: string) => { registered.push(['POST',   p]) },
      delete: (p: string) => { registered.push(['DELETE', p]) },
    }

    registerPassportRoutes(fakeRouter, { except: ['device', 'scopes'] })

    const paths = registered.map(r => r[1])
    assert.ok(!paths.some(p => p.includes('/device')),  'device routes skipped')
    assert.ok(!paths.some(p => p.endsWith('/scopes')),   'scopes route skipped')
    assert.ok(paths.some(p => p.endsWith('/authorize')), 'authorize route still registered')
    assert.ok(paths.some(p => p.endsWith('/token')),     'token route still registered')

    Passport.reset()
  })

  test('registerPassportRoutes with empty opts registers all route groups', () => {
    Passport.reset()
    const registered: string[] = []
    const fakeRouter = {
      get:    (p: string) => { registered.push(`GET ${p}`) },
      post:   (p: string) => { registered.push(`POST ${p}`) },
      delete: (p: string) => { registered.push(`DELETE ${p}`) },
    }
    registerPassportRoutes(fakeRouter)
    // authorize (GET/POST/DELETE) + token + tokens/:id + scopes + device/code + device/approve
    assert.equal(registered.length, 8)
  })

  test('DELETE /oauth/tokens/:id is registered with RequireBearer middleware', () => {
    // Token ids are semi-public (they appear in JWT `jti` claims). Without
    // bearer auth + ownership enforcement, anyone with one captured JWT can
    // DoS arbitrary users by revoking their tokens by id. Regression guard
    // for E2 from docs/plans/2026-05-06-passport-surface-review-fixes.md.
    Passport.reset()
    let revokeMiddleware: unknown[] | undefined
    const fakeRouter = {
      get:    () => {},
      post:   () => {},
      delete: (p: string, _h: unknown, mw?: unknown[]) => {
        if (p.endsWith('/tokens/:id')) revokeMiddleware = mw
      },
    }
    registerPassportRoutes(fakeRouter)
    assert.ok(Array.isArray(revokeMiddleware), 'revoke route must be registered with a middleware array')
    assert.equal(revokeMiddleware!.length, 1, 'revoke route should have exactly one middleware (RequireBearer)')
    const mw = revokeMiddleware![0] as { name?: string }
    assert.equal(typeof mw, 'function', 'middleware entry should be a function (RequireBearer)')
    assert.equal(mw.name, 'RequireBearer')
  })
})

describe('safeCompare — constant-time string comparison', () => {
  test('returns true for two equal hex strings', async () => {
    const a = 'a3b4c5d6e7f80123456789abcdef0123'
    assert.equal(await safeCompare(a, a), true)
  })

  test('returns true for two equal base64url strings', async () => {
    const a = 'q3RBZw7iOWB6XlxK6vFy_g'
    assert.equal(await safeCompare(a, a), true)
  })

  test('returns false on mismatch (same length)', async () => {
    assert.equal(await safeCompare('aaaaaa', 'bbbbbb'), false)
  })

  test('returns false on length mismatch', async () => {
    assert.equal(await safeCompare('abc', 'abcd'), false)
  })

  test('returns false when first arg is null', async () => {
    assert.equal(await safeCompare(null, 'abc'), false)
  })

  test('returns false when second arg is null', async () => {
    assert.equal(await safeCompare('abc', null), false)
  })

  test('returns false when both args are null', async () => {
    assert.equal(await safeCompare(null, null), false)
  })

  test('returns false when either arg is undefined', async () => {
    assert.equal(await safeCompare(undefined, 'abc'), false)
    assert.equal(await safeCompare('abc', undefined), false)
  })

  test('returns true for two empty strings (callers must guard against empty credentials)', async () => {
    assert.equal(await safeCompare('', ''), true)
  })
})

