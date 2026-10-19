import { describe, expect, it, vi } from 'vitest'
import { withRetry } from '../src/ingest/retry'

describe('withRetry', () => {
  it('returns as soon as a call succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('503')).mockResolvedValue('ok')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(withRetry('test', fn, { baseDelayMs: 0 })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('gives up after the attempt limit with the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('still down'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(withRetry('test', fn, { attempts: 3, baseDelayMs: 0 })).rejects.toThrow('still down')
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
