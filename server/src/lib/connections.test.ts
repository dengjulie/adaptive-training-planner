import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, pool } from '../db/client.ts'
import { users } from '../db/schema.ts'
import { getAccessToken, getConnection, saveConnection, type Refresher } from './connections.ts'
import { decryptSecret } from './crypto.ts'
import { ReauthRequiredError } from './errors.ts'

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000)

let userId: string

beforeEach(async () => {
  await db.delete(users)
  const [user] = await db
    .insert(users)
    .values({ googleSub: 'test-sub', email: 'test@example.invalid' })
    .returning()
  userId = user.id
})

afterAll(() => pool.end())

describe('getAccessToken', () => {
  it('returns the stored token while it is fresh', async () => {
    await saveConnection(userId, 'oura', {
      accessToken: 'fresh',
      refreshToken: 'r1',
      expiresAt: minutesFromNow(60),
    })
    const refresh = vi.fn<Refresher>()

    expect(await getAccessToken(userId, 'oura', refresh)).toBe('fresh')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes once for concurrent callers and stores the rotated refresh token', async () => {
    await saveConnection(userId, 'oura', {
      accessToken: 'old',
      refreshToken: 'r1',
      expiresAt: minutesFromNow(1),
    })
    const refresh = vi.fn<Refresher>(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return { accessToken: 'new', refreshToken: 'r2', expiresAt: minutesFromNow(60) }
    })

    const tokens = await Promise.all([1, 2, 3].map(() => getAccessToken(userId, 'oura', refresh)))

    expect(tokens).toEqual(['new', 'new', 'new'])
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh.mock.calls[0]?.[0]).toBe('r1')
    const stored = await getConnection(userId, 'oura')
    expect(decryptSecret(stored?.refreshToken ?? '')).toBe('r2')
  })

  it('replaces a rejected token unless another caller already did', async () => {
    await saveConnection(userId, 'coros', {
      accessToken: 'rejected',
      refreshToken: 'r1',
      expiresAt: minutesFromNow(60),
    })
    const refresh = vi.fn<Refresher>(async () => ({
      accessToken: 'replacement',
      refreshToken: 'r2',
      expiresAt: minutesFromNow(60),
    }))

    const first = await getAccessToken(userId, 'coros', refresh, { rejectedToken: 'rejected' })
    const second = await getAccessToken(userId, 'coros', refresh, { rejectedToken: 'rejected' })

    expect([first, second]).toEqual(['replacement', 'replacement'])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps the stored refresh token when the provider does not send a new one', async () => {
    await saveConnection(userId, 'google', {
      accessToken: 'old',
      refreshToken: 'long-lived',
      expiresAt: minutesFromNow(1),
    })
    const refresh = vi.fn<Refresher>(async () => ({
      accessToken: 'new',
      expiresAt: minutesFromNow(60),
    }))

    await getAccessToken(userId, 'google', refresh)

    const stored = await getConnection(userId, 'google')
    expect(decryptSecret(stored?.refreshToken ?? '')).toBe('long-lived')
  })

  it('flags the connection for reconnect when the refresh token is rejected', async () => {
    await saveConnection(userId, 'oura', {
      accessToken: 'old',
      refreshToken: 'spent',
      expiresAt: minutesFromNow(1),
    })
    const refresh = vi.fn<Refresher>(async () => {
      throw new ReauthRequiredError('oura')
    })

    await expect(getAccessToken(userId, 'oura', refresh)).rejects.toThrow(ReauthRequiredError)
    expect((await getConnection(userId, 'oura'))?.status).toBe('reauth_required')

    // Later callers fail fast instead of retrying a dead refresh token.
    await expect(getAccessToken(userId, 'oura', refresh)).rejects.toThrow(ReauthRequiredError)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
