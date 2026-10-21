import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { env } from '../env.ts'

const ALGORITHM = 'aes-256-gcm'
const FORMAT_VERSION = 'v1'
const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64')

/**
 * Encrypts a secret (e.g. an OAuth token) for storage at rest with AES-256-GCM.
 * Output format: `v1.<iv>.<ciphertext>.<authTag>`, each part base64url-encoded.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [FORMAT_VERSION, iv, ciphertext, cipher.getAuthTag()]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.')
}

/** Reverses {@link encryptSecret}. Throws if the payload was tampered with or uses another key. */
export function decryptSecret(payload: string): string {
  const [version, iv, ciphertext, authTag] = payload.split('.')
  if (version !== FORMAT_VERSION || !iv || !ciphertext || !authTag) {
    throw new Error('Unrecognized encrypted secret format')
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(authTag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
