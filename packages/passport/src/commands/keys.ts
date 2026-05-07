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
  const { existsSync } = await import('node:fs')
  const { join } = await import('node:path')

  const keyDir = join(process.cwd(), Passport.keyPath())
  const privatePath = join(keyDir, 'oauth-private.key')
  const publicPath  = join(keyDir, 'oauth-public.key')
  const previousPublicPath = join(keyDir, 'oauth-previous-public.key')

  const privateExists = existsSync(privatePath)
  const publicExists  = existsSync(publicPath)

  if (!opts.force && privateExists) {
    throw new Error(`Keys already exist at ${privatePath}. Use --force to overwrite.`)
  }

  await mkdir(keyDir, { recursive: true })

  let backup: GenerateKeysResult['backup'] = null
  let previousPublicWritten: string | null = null
  if (opts.force && (privateExists || publicExists)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const privateBackup = `${privatePath}.bak.${stamp}`
    const publicBackup  = `${publicPath}.bak.${stamp}`
    // Copy the public key to the rolling "previous" slot BEFORE renaming —
    // the verifier loads from `oauth-previous-public.key` so JWTs signed by
    // the about-to-rotate key keep verifying during their natural lifetime.
    if (publicExists) {
      await copyFile(publicPath, previousPublicPath)
      previousPublicWritten = previousPublicPath
    }
    if (privateExists) await rename(privatePath, privateBackup)
    if (publicExists)  await rename(publicPath,  publicBackup)
    backup = { privatePath: privateBackup, publicPath: publicBackup }
  }

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })

  await writeFile(privatePath, privateKey, { mode: 0o600 })
  await writeFile(publicPath, publicKey, { mode: 0o644 })

  return { privatePath, publicPath, backup, previousPublicPath: previousPublicWritten }
}
