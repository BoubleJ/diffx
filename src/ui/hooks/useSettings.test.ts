import { describe, it, expect, vi } from 'vitest'
import { putSettings } from './useSettings'

describe('putSettings', () => {
  it('sends only the changed settings', async () => {
    const fetchFn = vi.fn(async () => new Response('{}')) as unknown as typeof fetch
    await putSettings({ softWrap: true }, fetchFn)
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/settings')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ softWrap: true })
  })
})
