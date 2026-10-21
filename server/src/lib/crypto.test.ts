import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, safeEqual } from './crypto.ts'

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a secret', () => {
    const secret = 'example-access-token'
    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })

  it('uses a fresh IV for every encryption', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('rejects tampered ciphertext', () => {
    const [version, iv, ciphertext, tag] = encryptSecret('refresh-token').split('.')
    const flipped = Buffer.from(ciphertext, 'base64url')
    flipped[0] ^= 0xff
    const tampered = [version, iv, flipped.toString('base64url'), tag].join('.')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('rejects unknown formats', () => {
    expect(() => decryptSecret('plaintext-token')).toThrow('Unrecognized')
  })
})

describe('safeEqual', () => {
  it('compares strings of different lengths without throwing', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('abc', 'abc')).toBe(true)
  })
})
