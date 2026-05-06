import { Passport } from '../Passport.js'

export interface GenerateKeysResult {
  privatePath: string
  publicPath:  string
  /** Backup paths if existing keys were rotated under --force; null otherwise. */
  backup: { privatePath: string; publicPath: string } | null
}

/**
 * Generate RSA keypair for JWT signing.
 * Writes to storage/oauth-private.key and storage/oauth-public.key.
 *
 * With `--force`, existing keys are renamed to `*.bak.<ISO-timestamp>` before
 * being replaced. Long-lived JWTs signed by the old key still fail verification
 * (the public key changed), but the originals are recoverable from disk.
 */
export async function generateKeys(opts: { force?: boolean } = {}): Promise<GenerateKeysResult> {
  const { generateKeyPairSync } = await import('node:crypto')
  const { writeFile, mkdir, rename } = await import('node:fs/promises')
  const { existsSync } = await import('node:fs')
  const { join } = await import('node:path')

  const keyDir = join(process.cwd(), Passport.keyPath())
  const privatePath = join(keyDir, 'oauth-private.key')
  const publicPath  = join(keyDir, 'oauth-public.key')

  const privateExists = existsSync(privatePath)
  const publicExists  = existsSync(publicPath)

  if (!opts.force && privateExists) {
    throw new Error(`Keys already exist at ${privatePath}. Use --force to overwrite.`)
  }

  await mkdir(keyDir, { recursive: true })

  let backup: GenerateKeysResult['backup'] = null
  if (opts.force && (privateExists || publicExists)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const privateBackup = `${privatePath}.bak.${stamp}`
    const publicBackup  = `${publicPath}.bak.${stamp}`
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

  return { privatePath, publicPath, backup }
}
