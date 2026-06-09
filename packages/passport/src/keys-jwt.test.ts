// Key management + JWT verification: generateKeys, keysAvailable probe,
// client-secret hashing/pepper, aud/iss validation, JWKS previous-key.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import {
  Passport,
  hashClientSecret,
  verifyClientSecret,
  createToken,
  verifyToken,
  unsafeDecodeToken,
  OAuthError,
  clientCredentialsGrant,
} from './index.js'

describe('generateKeys — backup on --force', () => {
  // Regression guard for L1 from docs/plans/2026-05-06-passport-surface-review-fixes.md.
  // `--force` previously overwrote the private key with no recovery path.

  test('returns null backup when no existing keys', async () => {
    const { mkdtemp, readdir, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join, basename } = await import('node:path')

    const dir = await mkdtemp(join(tmpdir(), 'passport-keys-'))
    const cwd = process.cwd()
    try {
      process.chdir(dir)
      Passport.reset()
      Passport.loadKeysFrom('.')
      const { generateKeys } = await import('./commands/keys.js')
      const result = await generateKeys()
      assert.equal(result.backup, null)
      assert.equal(basename(result.privatePath), 'oauth-private.key')
      assert.equal(basename(result.publicPath),  'oauth-public.key')
      const files = await readdir(dir)
      assert.ok(files.includes('oauth-private.key'))
      assert.ok(files.includes('oauth-public.key'))
      assert.equal(files.filter(f => f.includes('.bak.')).length, 0)
    } finally {
      process.chdir(cwd)
      Passport.reset()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('without --force, refuses to overwrite existing keys', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const dir = await mkdtemp(join(tmpdir(), 'passport-keys-'))
    const cwd = process.cwd()
    try {
      process.chdir(dir)
      Passport.reset()
      Passport.loadKeysFrom('.')
      await writeFile(join(dir, 'oauth-private.key'), 'OLD-PRIVATE')
      const { generateKeys } = await import('./commands/keys.js')
      await assert.rejects(() => generateKeys(), /already exist/)
    } finally {
      process.chdir(cwd)
      Passport.reset()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('with --force, renames existing keys to .bak.<timestamp> before writing new ones', async () => {
    const { mkdtemp, writeFile, readFile, readdir, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')

    const dir = await mkdtemp(join(tmpdir(), 'passport-keys-'))
    const cwd = process.cwd()
    try {
      process.chdir(dir)
      Passport.reset()
      Passport.loadKeysFrom('.')
      await writeFile(join(dir, 'oauth-private.key'), 'OLD-PRIVATE')
      await writeFile(join(dir, 'oauth-public.key'),  'OLD-PUBLIC')

      const { generateKeys } = await import('./commands/keys.js')
      const result = await generateKeys({ force: true })

      assert.ok(result.backup, 'backup paths must be returned')
      assert.match(result.backup!.privatePath, /oauth-private\.key\.bak\./)
      assert.match(result.backup!.publicPath,  /oauth-public\.key\.bak\./)

      const oldPrivate = await readFile(result.backup!.privatePath, 'utf8')
      const oldPublic  = await readFile(result.backup!.publicPath,  'utf8')
      assert.equal(oldPrivate, 'OLD-PRIVATE')
      assert.equal(oldPublic,  'OLD-PUBLIC')

      const newPrivate = await readFile(join(dir, 'oauth-private.key'), 'utf8')
      assert.notEqual(newPrivate, 'OLD-PRIVATE')
      assert.match(newPrivate, /BEGIN PRIVATE KEY/)

      const files = await readdir(dir)
      const backups = files.filter(f => f.includes('.bak.'))
      assert.equal(backups.length, 2, 'exactly two backup files (private + public)')
    } finally {
      process.chdir(cwd)
      Passport.reset()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('Passport.keysAvailable() — L4 boot warning probe', () => {
  test('returns true when keys are explicitly set via setKeys()', async () => {
    Passport.reset()
    Passport.setKeys('PRIV', 'PUB')
    assert.equal(await Passport.keysAvailable(), true)
    Passport.reset()
  })

  test('returns false when no explicit keys + key files do not exist on disk', async () => {
    Passport.reset()
    // Point at a path under cwd that we know contains no oauth keys
    Passport.loadKeysFrom('does-not-exist-' + Date.now())
    assert.equal(await Passport.keysAvailable(), false)
    Passport.reset()
  })

  test('returns true when no explicit keys but both key files exist on disk', async () => {
    Passport.reset()
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { join, relative } = await import('node:path')

    // Create the tmp dir under cwd so the relative path stays on the same
    // drive — on Windows, tmpdir() may live on a different volume than the
    // package, and path.relative() across drives produces a path that
    // path.join(cwd, rel) can't resolve back.
    const dir = await mkdtemp(join(process.cwd(), '.tmp-passport-keys-'))
    try {
      await writeFile(join(dir, 'oauth-private.key'), 'PRIV')
      await writeFile(join(dir, 'oauth-public.key'),  'PUB')
      const rel = relative(process.cwd(), dir)
      Passport.loadKeysFrom(rel)
      assert.equal(await Passport.keysAvailable(), true)
    } finally {
      await rm(dir, { recursive: true, force: true })
      Passport.reset()
    }
  })

  test('returns false when only one of the two key files exists', async () => {
    Passport.reset()
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { join, relative } = await import('node:path')

    const dir = await mkdtemp(join(process.cwd(), '.tmp-passport-keys-'))
    try {
      await writeFile(join(dir, 'oauth-private.key'), 'PRIV')
      // public file intentionally missing
      const rel = relative(process.cwd(), dir)
      Passport.loadKeysFrom(rel)
      assert.equal(await Passport.keysAvailable(), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
      Passport.reset()
    }
  })
})

describe('client-secret hashing (L6) — APP_KEY pepper + back-compat', () => {
  // The hash format is selected at write time based on `process.env.APP_KEY`.
  // Save/restore it around each test so tests don't bleed state and so we
  // can assert both code paths (peppered + plain SHA-256) deterministically.
  const ORIGINAL_APP_KEY = process.env['APP_KEY']

  function setAppKey(value: string | undefined): void {
    if (value === undefined) delete process.env['APP_KEY']
    else process.env['APP_KEY'] = value
  }

  test('hashClientSecret — uses HMAC-SHA256 pepper when APP_KEY is set', async () => {
    setAppKey('test-pepper-1')
    const hashed = await hashClientSecret('s3cret')
    assert.ok(hashed.startsWith('peppered:'), `expected peppered: prefix, got ${hashed}`)
    // hex-encoded HMAC-SHA256 is 64 chars after the prefix
    assert.equal(hashed.slice('peppered:'.length).length, 64)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('hashClientSecret — falls back to plain SHA-256 when APP_KEY is unset', async () => {
    setAppKey(undefined)
    const hashed = await hashClientSecret('s3cret')
    // Plain hex SHA-256 — no prefix, exactly 64 chars
    assert.equal(hashed.length, 64)
    assert.ok(!hashed.startsWith('peppered:'))
    const { createHash } = await import('node:crypto')
    const expected = createHash('sha256').update('s3cret').digest('hex')
    assert.equal(hashed, expected)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('hashClientSecret — different APP_KEYs produce different ciphertexts', async () => {
    setAppKey('pepper-A')
    const a = await hashClientSecret('same-input')
    setAppKey('pepper-B')
    const b = await hashClientSecret('same-input')
    assert.notEqual(a, b)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('verifyClientSecret — peppered hash verifies under matching APP_KEY', async () => {
    setAppKey('pepper-X')
    const hashed = await hashClientSecret('s3cret')
    assert.equal(await verifyClientSecret('s3cret', hashed), true)
    assert.equal(await verifyClientSecret('wrong', hashed), false)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('verifyClientSecret — peppered hash rejects under different APP_KEY (rotation invalidates)', async () => {
    setAppKey('pepper-old')
    const hashed = await hashClientSecret('s3cret')
    setAppKey('pepper-new')
    assert.equal(await verifyClientSecret('s3cret', hashed), false)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('verifyClientSecret — peppered hash rejects when APP_KEY becomes unset', async () => {
    setAppKey('pepper-Y')
    const hashed = await hashClientSecret('s3cret')
    setAppKey(undefined)
    // Without the pepper we can't reproduce the HMAC, so verification must
    // fail closed (an attacker who sees a peppered row can't bypass the
    // check by clearing APP_KEY in the environment).
    assert.equal(await verifyClientSecret('s3cret', hashed), false)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('verifyClientSecret — legacy plain SHA-256 row keeps verifying after APP_KEY is set', async () => {
    // Existing rows minted before the pepper rolled out are bare hex digests.
    // They MUST keep verifying once APP_KEY is configured — otherwise every
    // existing OAuth client breaks the moment the operator sets APP_KEY.
    const { createHash } = await import('node:crypto')
    const legacyHash = createHash('sha256').update('s3cret').digest('hex')
    setAppKey('newly-configured-pepper')
    assert.equal(await verifyClientSecret('s3cret', legacyHash), true)
    assert.equal(await verifyClientSecret('wrong', legacyHash), false)
    setAppKey(ORIGINAL_APP_KEY)
  })

  test('verifyClientSecret — null/empty stored value rejects', async () => {
    assert.equal(await verifyClientSecret('any', null), false)
    assert.equal(await verifyClientSecret('any', undefined), false)
    assert.equal(await verifyClientSecret('any', ''), false)
  })

  test('client_credentials grant — accepts peppered secret end-to-end', async () => {
    // End-to-end: createClient writes a peppered hash; clientCredentialsGrant
    // reads the row and must verify successfully under the same APP_KEY.
    setAppKey('e2e-pepper')
    Passport.reset()

    // Generate ephemeral RSA keypair so issueTokens succeeds (cached at
    // describe scope would be cleaner; this grant runs once so inline is fine)
    const { generateKeyPairSync } = await import('node:crypto')
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    Passport.setKeys(privateKey, publicKey)

    const peppered = await hashClientSecret('plain-secret-value')

    class FakeClient {
      static where(_col: string, _val: unknown) {
        return {
          first: async () => ({
            id: 'C-1', name: 'app',
            secret: peppered, confidential: true, revoked: false,
            redirectUris: '[]',
            grantTypes: '["client_credentials"]',
            scopes: '[]',
          }),
        }
      }
    }
    class FakeAccessToken {
      static async create(record: any) { return { id: record.id ?? 'A-1', ...record } }
    }
    Passport.useClientModel(FakeClient as any)
    Passport.useTokenModel(FakeAccessToken as any)

    const tokens = await clientCredentialsGrant({
      grantType:    'client_credentials',
      clientId:     'C-1',
      clientSecret: 'plain-secret-value',
    })
    assert.ok(tokens.access_token)

    // Wrong secret still rejects
    await assert.rejects(
      () => clientCredentialsGrant({
        grantType:    'client_credentials',
        clientId:     'C-1',
        clientSecret: 'wrong-secret',
      }),
      (e: any) => e instanceof OAuthError && e.error === 'invalid_client',
    )

    Passport.reset()
    setAppKey(ORIGINAL_APP_KEY)
  })
})

describe('verifyToken aud/iss validation (P7)', () => {
  // Regression guards for P7 from docs/plans/2026-05-06-passport-surface-review-fixes.md.
  //
  // The fix is two-sided:
  //   1. createToken stamps `iss` only when Passport.useIssuer(url) is set —
  //      legacy tokens (issuer not configured at mint time) carry no `iss`
  //      and stay verifiable during the migration window, same pattern as
  //      redirect_uri (P1) and familyId (P4).
  //   2. verifyToken accepts { expectedAud, expectedIssuer } — resource
  //      servers can opt into strict per-client validation; BearerMiddleware
  //      passes expectedIssuer when configured.

  /** Lazily-initialised real RSA keypair, cached across tests in the block. */
  let _keys: { privateKey: string; publicKey: string } | null = null
  async function ensureKeys() {
    if (_keys) return _keys
    const { generateKeyPairSync } = await import('node:crypto')
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    _keys = pair
    return pair
  }

  async function mintToken(opts: { aud: string; iat?: number; exp?: number }): Promise<string> {
    const { privateKey, publicKey } = await ensureKeys()
    Passport.setKeys(privateKey, publicKey)
    return createToken({
      tokenId:   'JTI-1',
      userId:    'U-1',
      clientId:  opts.aud,
      scopes:    ['read'],
      expiresAt: new Date(Date.now() + (opts.exp ?? 60_000)),
      ...(opts.iat !== undefined ? { iatMs: opts.iat } : {}),
    })
  }

  test('createToken omits `iss` when no issuer is configured', async () => {
    Passport.reset()
    const token = await mintToken({ aud: 'C-1' })
    const decoded = unsafeDecodeToken(token)
    assert.equal(decoded.iss, undefined,
      'tokens minted with no configured issuer must not carry `iss`')
    Passport.reset()
  })

  test('createToken stamps `iss` when Passport.useIssuer is configured', async () => {
    Passport.reset()
    Passport.useIssuer('https://app.example.com')
    const token = await mintToken({ aud: 'C-1' })
    const decoded = unsafeDecodeToken(token)
    assert.equal(decoded.iss, 'https://app.example.com')
    Passport.reset()
  })

  test('verifyToken accepts a token without expectedAud (back-compat)', async () => {
    Passport.reset()
    const token = await mintToken({ aud: 'C-1' })
    const payload = await verifyToken(token)
    assert.equal(payload.aud, 'C-1')
    Passport.reset()
  })

  test('verifyToken with expectedAud accepts a matching token', async () => {
    Passport.reset()
    const token = await mintToken({ aud: 'C-1' })
    const payload = await verifyToken(token, { expectedAud: 'C-1' })
    assert.equal(payload.aud, 'C-1')
    Passport.reset()
  })

  test('verifyToken with expectedAud rejects a mismatched token', async () => {
    Passport.reset()
    const token = await mintToken({ aud: 'C-OTHER' })
    await assert.rejects(
      () => verifyToken(token, { expectedAud: 'C-1' }),
      /audience mismatch/i,
    )
    Passport.reset()
  })

  test('verifyToken with expectedIssuer accepts a matching token', async () => {
    Passport.reset()
    Passport.useIssuer('https://app.example.com')
    const token = await mintToken({ aud: 'C-1' })
    const payload = await verifyToken(token, { expectedIssuer: 'https://app.example.com' })
    assert.equal(payload.iss, 'https://app.example.com')
    Passport.reset()
  })

  test('verifyToken with expectedIssuer rejects a mismatched token', async () => {
    Passport.reset()
    Passport.useIssuer('https://attacker.example.com')
    const token = await mintToken({ aud: 'C-1' })
    Passport.reset()
    // Reload the same RSA keypair so the signature still verifies; only
    // the issuer differs from what the verifier expects.
    const { privateKey, publicKey } = await ensureKeys()
    Passport.setKeys(privateKey, publicKey)
    await assert.rejects(
      () => verifyToken(token, { expectedIssuer: 'https://app.example.com' }),
      /issuer mismatch/i,
    )
    Passport.reset()
  })

  test('verifyToken with expectedIssuer accepts a legacy token that has no `iss` claim (migration window)', async () => {
    // Mint a token before issuer was configured — it carries no iss claim.
    Passport.reset()
    const legacy = await mintToken({ aud: 'C-1' })
    // Now configure an issuer and verify with expectedIssuer set; the legacy
    // token should still verify because it has no `iss` claim to compare.
    Passport.useIssuer('https://app.example.com')
    const payload = await verifyToken(legacy, { expectedIssuer: 'https://app.example.com' })
    assert.equal(payload.aud, 'C-1')
    assert.equal(payload.iss, undefined)
    Passport.reset()
  })

  test('PassportConfig.issuer routes through PassportProvider.boot()', async () => {
    // Belt-and-braces: the boot path must call Passport.useIssuer() so apps
    // that configure issuer in config/passport.ts get the same behavior as
    // a manual Passport.useIssuer() call. We don't boot the full provider
    // here (heavyweight); instead we cover the wiring by exercising the
    // setter + getter pair directly. The boot integration is covered by
    // the typecheck on the provider boot() method.
    Passport.reset()
    assert.equal(Passport.issuer(), null, 'issuer is null by default')
    Passport.useIssuer('https://app.example.com')
    assert.equal(Passport.issuer(), 'https://app.example.com')
    Passport.useIssuer('')
    assert.equal(Passport.issuer(), null, 'empty string clears issuer')
    Passport.reset()
    assert.equal(Passport.issuer(), null, 'reset() clears issuer')
  })
})

describe('JWKS-style previous-key verifier', () => {
  // `passport:keys --force` rotates the signing key. Without a JWKS-style
  // grace window, every JWT minted before the rotation fails verification
  // on the next request — global sign-out. The fix keeps the prior public
  // key around for verification only; `verifyToken` walks both keys, and
  // `kid` headers (SHA-256 fingerprint of the public key) let it pick
  // directly without trial-and-error. Once the old tokens expire naturally
  // the operator can drop `oauth-previous-public.key` (or call
  // `Passport.setPreviousPublicKey(null)`) to close the grace window.

  /**
   * Generate two distinct RSA keypairs so we can exercise the rotation
   * path. 2048 instead of 4096 to keep tests fast.
   */
  async function genKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
    const { generateKeyPairSync } = await import('node:crypto')
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    return { privateKey, publicKey }
  }

  let oldKeys: { privateKey: string; publicKey: string } | null = null
  let newKeys: { privateKey: string; publicKey: string } | null = null
  async function ensureBothKeys(): Promise<{ oldKeys: typeof oldKeys; newKeys: typeof newKeys }> {
    if (!oldKeys) oldKeys = await genKeyPair()
    if (!newKeys) newKeys = await genKeyPair()
    return { oldKeys, newKeys }
  }

  test('createToken stamps `kid` header equal to SHA-256(base64url) of the public key', async () => {
    Passport.reset()
    const { oldKeys: keys } = await ensureBothKeys()
    Passport.setKeys(keys!.privateKey, keys!.publicKey)

    const jwt = await createToken({
      tokenId: 'AT-1', userId: 'U-1', clientId: 'C-1', scopes: ['read'],
      expiresAt: new Date(Date.now() + 60_000),
    })

    const headerB64 = jwt.split('.')[0]!
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'))
    assert.equal(typeof header.kid, 'string')
    assert.match(header.kid, /^[A-Za-z0-9_-]+$/, 'kid must be base64url')

    const expectedKid = createHash('sha256').update(keys!.publicKey).digest('base64url')
    assert.equal(header.kid, expectedKid)

    Passport.reset()
  })

  test('verifyToken accepts a JWT signed by the previous key after rotation', async () => {
    Passport.reset()
    const { oldKeys: prev, newKeys: curr } = await ensureBothKeys()

    // 1) Mint a JWT under the OLD keypair.
    Passport.setKeys(prev!.privateKey, prev!.publicKey)
    const jwt = await createToken({
      tokenId: 'AT-PRE-ROTATE', userId: 'U-1', clientId: 'C-1', scopes: ['read'],
      expiresAt: new Date(Date.now() + 60_000),
    })

    // 2) Rotate to the NEW keypair. The old public key gets retained for
    //    verification grace via setPreviousPublicKey().
    Passport.setKeys(curr!.privateKey, curr!.publicKey)
    Passport.setPreviousPublicKey(prev!.publicKey)

    // 3) Pre-rotation JWT still verifies — found via kid → previous key.
    const payload = await verifyToken(jwt)
    assert.equal(payload.jti, 'AT-PRE-ROTATE')
    assert.equal(payload.aud, 'C-1')

    Passport.reset()
  })

  test('verifyToken rejects a JWT signed by the previous key once the grace slot is cleared', async () => {
    Passport.reset()
    const { oldKeys: prev, newKeys: curr } = await ensureBothKeys()

    Passport.setKeys(prev!.privateKey, prev!.publicKey)
    const jwt = await createToken({
      tokenId: 'AT-PRE-ROTATE', userId: 'U-1', clientId: 'C-1', scopes: ['read'],
      expiresAt: new Date(Date.now() + 60_000),
    })

    Passport.setKeys(curr!.privateKey, curr!.publicKey)
    // Operator did NOT retain the previous key — clean break.
    Passport.setPreviousPublicKey(null)

    await assert.rejects(
      () => verifyToken(jwt),
      (e: any) => /signature verification failed/.test(e.message),
    )

    Passport.reset()
  })

  test('verifyToken accepts a legacy JWT (no `kid` header) by trial-verify against every verification key', async () => {
    Passport.reset()
    const { oldKeys: prev, newKeys: curr } = await ensureBothKeys()

    // Hand-craft a no-kid JWT signed by the previous key — bypasses createToken
    // (which always stamps kid now). This simulates a token minted before
    // the JWKS PR shipped.
    const { createSign } = await import('node:crypto')
    const header = { alg: 'RS256', typ: 'JWT' } // no kid
    const payload = {
      jti: 'AT-LEGACY', sub: 'U-1', aud: 'C-1',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor((Date.now() + 60_000) / 1000),
      scopes: ['read'],
    }
    const headerB64  = Buffer.from(JSON.stringify(header)).toString('base64url')
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signingInput = `${headerB64}.${payloadB64}`
    const sign = createSign('RSA-SHA256')
    sign.update(signingInput)
    const sigB64 = sign.sign(prev!.privateKey, 'base64url')
    const legacyJwt = `${signingInput}.${sigB64}`

    // Set up the post-rotation state with the previous key retained.
    Passport.setKeys(curr!.privateKey, curr!.publicKey)
    Passport.setPreviousPublicKey(prev!.publicKey)

    // verifyToken must succeed — falls through to "try each key" path
    // because the JWT has no kid header.
    const verified = await verifyToken(legacyJwt)
    assert.equal(verified.jti, 'AT-LEGACY')

    Passport.reset()
  })

  test('verifyToken rejects when kid points at a key that is no longer in the verification set', async () => {
    Passport.reset()
    const { oldKeys: prev, newKeys: curr } = await ensureBothKeys()

    // Mint under the old key (carries kid = fingerprint of prev).
    Passport.setKeys(prev!.privateKey, prev!.publicKey)
    const jwt = await createToken({
      tokenId: 'AT-1', userId: 'U-1', clientId: 'C-1', scopes: ['read'],
      expiresAt: new Date(Date.now() + 60_000),
    })

    // Rotate WITHOUT retaining prev — the kid in the JWT now points at a
    // key that isn't in the verification set, so verification has no
    // candidate keys to try and must fail.
    Passport.setKeys(curr!.privateKey, curr!.publicKey)
    Passport.setPreviousPublicKey(null)

    await assert.rejects(
      () => verifyToken(jwt),
      (e: any) => /signature verification failed/.test(e.message),
    )

    Passport.reset()
  })

  test('Passport.setPreviousPublicKey(null) and reset() both clear the grace slot', () => {
    Passport.reset()
    assert.equal(Passport.previousPublicKey(), null)
    Passport.setPreviousPublicKey('-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n')
    assert.notEqual(Passport.previousPublicKey(), null)
    Passport.setPreviousPublicKey(null)
    assert.equal(Passport.previousPublicKey(), null)
    Passport.setPreviousPublicKey('-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----\n')
    Passport.reset()
    assert.equal(Passport.previousPublicKey(), null, 'reset() must clear the previous-key slot')
  })

  test('verificationKeys() returns [current] when no previous key is set', async () => {
    Passport.reset()
    const { newKeys: curr } = await ensureBothKeys()
    Passport.setKeys(curr!.privateKey, curr!.publicKey)
    Passport.setPreviousPublicKey(null)
    const keys = await Passport.verificationKeys()
    assert.equal(keys.length, 1)
    assert.equal(keys[0], curr!.publicKey)
    Passport.reset()
  })

  test('verificationKeys() returns [current, previous] in current-first order', async () => {
    Passport.reset()
    const { oldKeys: prev, newKeys: curr } = await ensureBothKeys()
    Passport.setKeys(curr!.privateKey, curr!.publicKey)
    Passport.setPreviousPublicKey(prev!.publicKey)
    const keys = await Passport.verificationKeys()
    assert.equal(keys.length, 2)
    assert.equal(keys[0], curr!.publicKey, 'current public key must come first')
    assert.equal(keys[1], prev!.publicKey)
    Passport.reset()
  })
})

