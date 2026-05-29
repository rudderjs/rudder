import { Passport } from '../Passport.js'

export interface GenerateKeysResult {
  privatePath: string
  publicPath:  string
  /** Backup paths if existing keys were rotated under --force; null otherwise. */
  backup: { privatePath: string; publicPath: string } | null
  /**
   * Path of the rolling "previous public key" written under --force. The
   * verifier (Passport.verificationKeys()) picks this up automatically, so
   * JWTs signed before the rotation keep verifying during their natural
   * lifetime instead of all logging out at the next request. Distinct from
   * the timestamped audit `backup` files — `previousPublicPath` always
   * lives at `oauth-previous-public.key` and gets overwritten on the next
   * rotation. Null on first generation (no prior key to retain).
   */
  previousPublicPath: string | null
}

/**
 * Generate RSA keypair for JWT signing.
 * Writes to storage/oauth-private.key and storage/oauth-public.key.
 *
 * With `--force`, existing keys are renamed to `*.bak.<ISO-timestamp>` before
 * being replaced AND the prior public key is also copied to
 * `oauth-previous-public.key`. The verifier walks both keys during the
 * grace window (until the prior tokens expire naturally), so a rotation no
 * longer forces an immediate global sign-out. The audit backups live
 * alongside for full recovery; the previous-public file is the operational
 * one that the verifier consults.
 */
export async function generateKeys(opts: { force?: boolean } = {}): Promise<GenerateKeysResult> {
  const { generateKeyPairSync } = await import('node:crypto')
  const { writeFile, mkdir, rename, copyFile } = await import('node:fs/promises')
  const { join } = await import('node:path')

  const isENOENT = (err: unknown): boolean => (err as NodeJS.ErrnoException).code === 'ENOENT'

  const keyDir = join(process.cwd(), Passport.keyPath())
  const privatePath = join(keyDir, 'oauth-private.key')
  const publicPath  = join(keyDir, 'oauth-public.key')
  const previousPublicPath = join(keyDir, 'oauth-previous-public.key')

  await mkdir(keyDir, { recursive: true })

  let backup: GenerateKeysResult['backup'] = null
  let previousPublicWritten: string | null = null
  if (opts.force) {
    // Rotate any existing keys out of the way. We don't pre-check existence
    // (a check-then-write race) — instead we attempt the copy/rename and treat
    // ENOENT as "nothing there to rotate" (first generation under --force).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const privateBackup = `${privatePath}.bak.${stamp}`
    const publicBackup  = `${publicPath}.bak.${stamp}`
    // Copy the public key to the rolling "previous" slot BEFORE renaming —
    // the verifier loads from `oauth-previous-public.key` so JWTs signed by
    // the about-to-rotate key keep verifying during their natural lifetime.
    try {
      await copyFile(publicPath, previousPublicPath)
      previousPublicWritten = previousPublicPath
    } catch (err) { if (!isENOENT(err)) throw err }
    let rotated = false
    try { await rename(privatePath, privateBackup); rotated = true } catch (err) { if (!isENOENT(err)) throw err }
    try { await rename(publicPath,  publicBackup);  rotated = true } catch (err) { if (!isENOENT(err)) throw err }
    if (rotated) backup = { privatePath: privateBackup, publicPath: publicBackup }
  }

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  // `wx` = create exclusively. This is both the security boundary (the write
  // fails rather than following a pre-planted file/symlink at the key path)
  // AND the existence guard: without --force, an existing key makes the write
  // fail with EEXIST, which we surface as the "use --force" message. No
  // separate existsSync check — so there's no check-then-write window at all.
  try {
    await writeFile(privatePath, privateKey, { mode: 0o600, flag: 'wx' })
    await writeFile(publicPath, publicKey, { mode: 0o644, flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Keys already exist in ${keyDir}. Use --force to overwrite.`)
    }
    throw err
  }

  return { privatePath, publicPath, backup, previousPublicPath: previousPublicWritten }
}
